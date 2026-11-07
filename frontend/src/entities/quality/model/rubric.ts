import type { Criterion, Grade } from './contract'

export function allowedGradeValues(criterion: Criterion): Grade['value'][] {
  const values: Grade['value'][] = criterion.kind === 'scale' ? [...criterion.scale] : ['yes', 'no']
  if (criterion.kind !== 'flag' && criterion.allow_na) values.push('na')
  return values
}

export function gradeLabel(value: Grade['value'], criterion?: Criterion) {
  if (typeof value === 'number') {
    const max = criterion?.scale.at(-1)
    return max === undefined ? String(value) : `${value} / ${max}`
  }
  return { yes: 'Yes', no: 'No', na: 'N/A' }[value]
}

export function validateCriterion(criterion: Criterion) {
  const { id, label, instruction, kind, weight, scale, allow_na, na_rule } = criterion
  if (!id.trim() || !label.trim() || !instruction.trim()) return 'Enter a criterion ID, label and instruction.'
  if (kind === 'flag') {
    if (weight !== 0 || allow_na) return 'Flags must have zero weight and cannot use N/A.'
  } else if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    return 'Weight must be a whole number from 1 to 100.'
  }
  if (kind === 'scale') {
    if (scale.length < 2 || scale[0] !== 0 || scale.some((value, index) =>
      !Number.isSafeInteger(value) || (index > 0 && value <= scale[index - 1]))) {
      return 'Enter distinct whole-number scale steps in ascending order, starting at 0.'
    }
  } else if (scale.length) {
    return 'Only scale criteria can have scale steps.'
  }
  if (allow_na ? !na_rule?.trim() : na_rule !== null) return 'Provide an N/A rule only when N/A is allowed.'
  return null
}
