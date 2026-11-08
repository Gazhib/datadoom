import type { MessageKey } from '../../../shared/i18n/en'
import type { Translate } from '../../../shared/i18n/messages'
import type { Criterion, Grade } from './contract'

export function allowedGradeValues(criterion: Criterion): Grade['value'][] {
  const values: Grade['value'][] = criterion.kind === 'scale' ? [...criterion.scale] : ['yes', 'no']
  if (criterion.kind !== 'flag' && criterion.allow_na) values.push('na')
  return values
}

export function gradeLabel(value: Grade['value'], criterion: Criterion | undefined, t: Translate) {
  if (typeof value === 'number') {
    const max = criterion?.scale.at(-1)
    return max === undefined ? String(value) : `${value} / ${max}`
  }
  return t(value)
}

export type GradeTone = 'positive' | 'negative' | 'scale' | 'na'

// A "yes" on a flag criterion means the operator did something wrong. Scale ends read as met or missed.
export function gradeTone(value: Grade['value'], criterion: Criterion | undefined): GradeTone {
  if (value === 'na') return 'na'
  if (typeof value === 'number') {
    const max = criterion?.scale.at(-1)
    return value === max ? 'positive' : value === 0 && max !== undefined ? 'negative' : 'scale'
  }
  return (value === 'yes') !== (criterion?.kind === 'flag') ? 'positive' : 'negative'
}

export function validateCriterion(criterion: Criterion): MessageKey | null {
  const { id, label, instruction, kind, weight, scale, allow_na, na_rule } = criterion
  if (!id.trim() || !label.trim() || !instruction.trim()) return 'criterionIdentityRequired'
  if (kind === 'flag') {
    if (weight !== 0 || allow_na) return 'flagWeightRule'
  } else if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    return 'weightRange'
  }
  if (kind === 'scale') {
    if (scale.length < 2 || scale[0] !== 0 || scale.some((value, index) =>
      !Number.isSafeInteger(value) || (index > 0 && value <= scale[index - 1]))) {
      return 'scaleOrder'
    }
  } else if (scale.length) {
    return 'scaleStepsOnly'
  }
  if (allow_na ? !na_rule?.trim() : na_rule !== null) return 'naRuleRequired'
  return null
}
