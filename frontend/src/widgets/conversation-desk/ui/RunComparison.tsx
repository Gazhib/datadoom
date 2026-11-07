import type { MessageKey } from '../../../shared/i18n/en'
import { useI18n } from '../../../shared/i18n/useI18n'
import { useId, useState } from 'react'
import { gradeLabel } from '../../../entities/quality'
import type { Conversation, Criterion, Evaluation, Score, Turn } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import { EvidenceLinks } from './EvidenceLinks'
import type { EvidenceTarget } from './Transcript'
import './run-comparison.css'

const points = (value: number | null) => value === null ? '—' : value.toFixed(2)

function ruleSignature(criterion?: Criterion) {
  return criterion && JSON.stringify([
    criterion.label, criterion.instruction, criterion.kind, criterion.weight, criterion.scale,
    criterion.allow_na, criterion.na_rule, criterion.section,
  ])
}

function RunSummary({ evaluation }: { evaluation: Evaluation }) {
  const { t } = useI18n()
  return <div className="comparison-summary">
    <div className="comparison-version">
      <span className="version-chip">{evaluation.checklist.version_id}</span>
      <span className={`mode-badge ${evaluation.mode === 'fixture' ? 'mode-synthetic' : 'mode-live'}`}>
        {evaluation.mode === 'fixture' ? t('syntheticResult') : t('liveResult')}
      </span>
    </div>
    <p>{evaluation.checklist.name}</p>
    <dl className="comparison-totals">
      <div><dt>{t('originalTotal')}</dt><dd>{points(evaluation.original.total)}</dd></div>
      <div><dt>{t('finalTotal')}</dt><dd>{points(evaluation.final.total)}</dd></div>
    </dl>
    <p className={evaluation.final.serious_error ? 'comparison-flag' : 'comparison-no-flag'}>
      <Icon name={evaluation.final.serious_error ? 'flag' : 'shield'} size={14} />
      {evaluation.final.serious_error ? t('seriousErrorFlagged') : t('noSeriousErrors')}
    </p>
    {evaluation.final.total === null && <p className="form-note">{t('noWeightedCriteria')}</p>}
    <p className="run-identifier">{t('runReference', { id: evaluation.id })}</p>
    <p className="model-label">{evaluation.model.provider} / {evaluation.model.model}</p>
  </div>
}

function ComparedGrade({ criterion, item, evaluation, turns, target, onEvidence }: {
  criterion?: Criterion
  item?: Score['items'][number]
  evaluation: Evaluation
  turns: Map<string, Turn>
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget) => void
}) {
  const { t } = useI18n()
  if (!criterion || !item) return <div className="comparison-grade comparison-missing">
    <p>{t('criterionNotInVersion', { version: evaluation.checklist.version_id })}</p>
  </div>

  const appeal = evaluation.appeals.find(({ criterion_id }) => criterion_id === criterion.id)
  const original = evaluation.original.items.find(({ criterion_id }) => criterion_id === criterion.id)

  return <div className="comparison-grade">
    <p className="comparison-cell-version">{evaluation.checklist.version_id}</p>
    <div className="comparison-grade-heading"><h4>{criterion.label}</h4><strong>{gradeLabel(item.value, criterion, t)}</strong></div>
    <div className="weight-row">
      <span>{t('weight')} <strong>{item.weight}</strong></span>
      <span>{t('effectiveWeight')} <strong>{item.effective_weight === null ? '—' : `${points(item.effective_weight)}%`}</strong></span>
      <span>{t('points')} <strong>{points(item.points)}</strong></span>
    </div>
    <p className="criterion-reason">{item.reason}</p>
    <EvidenceLinks grade={item} turns={turns} target={target} source={evaluation.id} onEvidence={onEvidence} />
    {appeal?.status === 'resolved' && <div className="comparison-decision">
      <p><strong>{appeal.decision?.action === 'change' ? t('gradeChanged') : t('gradeConfirmed')}</strong>
        {original && ` · ${t('originalGrade', { grade: gradeLabel(original.value, criterion, t) })}`}</p>
      <p><strong>{t('appealComment')}</strong> {appeal.comment}</p>
      <p><strong>{t('decisionReason')}</strong> {appeal.decision?.reason}</p>
    </div>}
    <details className="scoring-rule">
      <summary>{t('savedScoringRule')}</summary>
      <p>{criterion.instruction}</p>
      <p><strong>{t('answerType')}</strong> {t(criterion.kind)}{criterion.kind === 'scale' && ` · ${criterion.scale.join(', ')}`}</p>
      {criterion.na_rule && <p><strong>{t('na')}</strong> {criterion.na_rule}</p>}
      {criterion.section && <p><strong>{t('section')}</strong> {criterion.section}</p>}
    </details>
  </div>
}

export function RunComparison({ runs, current, conversation, target, onEvidence, onSelectionChange }: {
  runs: Evaluation[]
  current: Evaluation
  conversation: Conversation
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget) => void
  onSelectionChange: () => void
}) {
  const { t } = useI18n()
  const headingId = useId()
  const [referenceId, setReferenceId] = useState(() =>
    runs.find((run) => run.checklist.version_id !== current.checklist.version_id)?.id ?? current.id)
  const [comparisonId, setComparisonId] = useState(current.id)
  const [onlyChanges, setOnlyChanges] = useState(false)
  const reference = runs.find((run) => run.id === referenceId) ?? current
  const otherVersions = runs.filter((run) => run.checklist.version_id !== reference.checklist.version_id)
  const comparison = otherVersions.find((run) => run.id === comparisonId) ?? otherVersions[0]
  const turns = new Map(conversation.turns.map((turn) => [turn.id, turn]))

  if (!comparison) return <section className="run-comparison comparison-empty" aria-labelledby={headingId}>
    <Icon name="layers" size={22} /><h3 id={headingId}>{t('compareChecklistVersions')}</h3>
    <p>{t('comparisonEmpty')}</p>
  </section>

  const referenceCriteria = new Map(reference.checklist.criteria.map((criterion) => [criterion.id, criterion]))
  const comparisonCriteria = new Map(comparison.checklist.criteria.map((criterion) => [criterion.id, criterion]))
  const referenceGrades = new Map(reference.final.items.map((item) => [item.criterion_id, item]))
  const comparisonGrades = new Map(comparison.final.items.map((item) => [item.criterion_id, item]))
  const ids = [...new Set([...referenceCriteria.keys(), ...comparisonCriteria.keys()])]
  const rows = ids.map((id) => {
    const before = referenceCriteria.get(id)
    const after = comparisonCriteria.get(id)
    const beforeGrade = referenceGrades.get(id)
    const afterGrade = comparisonGrades.get(id)
    const changes: MessageKey[] = []
    if (!before) changes.push('criterionAdded')
    else if (!after) changes.push('criterionRemoved')
    else {
      if (ruleSignature(before) !== ruleSignature(after)) changes.push('ruleChanged')
      if (beforeGrade?.value !== afterGrade?.value) changes.push('gradeChanged')
      if (beforeGrade?.points !== afterGrade?.points || beforeGrade?.effective_weight !== afterGrade?.effective_weight) changes.push('pointsChanged')
      if (beforeGrade?.reason !== afterGrade?.reason) changes.push('rationaleChanged')
      const beforeEvidence = [...(beforeGrade?.evidence_turn_ids ?? [])].sort()
      const afterEvidence = [...(afterGrade?.evidence_turn_ids ?? [])].sort()
      if (JSON.stringify(beforeEvidence) !== JSON.stringify(afterEvidence)) changes.push('evidenceChanged')
    }
    return { id, before, after, beforeGrade, afterGrade, changes }
  })
  const changedCount = rows.filter((row) => row.changes.length).length
  const visibleRows = onlyChanges ? rows.filter((row) => row.changes.length) : rows

  return <section className="run-comparison" aria-labelledby={headingId}>
    <div className="comparison-heading">
      <div><p className="kicker">{t('comparisonKicker')}</p><h3 id={headingId}>{t('compareChecklistVersions')}</h3></div>
      <p className="comparison-count" role="status">{t('differentCriteria', { changed: changedCount, total: rows.length })}</p>
    </div>
    <p className="comparison-note">{t('comparisonNote')}</p>
    <div className="comparison-columns">
      <div>
        <label className="field"><span className="field-label">{t('referenceEvaluation')}</span>
          <select value={reference.id} onChange={(event) => { setReferenceId(event.target.value); onSelectionChange() }}>
            {runs.map((run, index) => <option value={run.id} key={run.id}>
              {run.checklist.version_id} · {index === 0 ? t('latestRun') : t('runNumber', { id: runs.length - index })}
            </option>)}
          </select>
        </label>
        <RunSummary evaluation={reference} />
      </div>
      <div>
        <label className="field"><span className="field-label">{t('comparisonEvaluation')}</span>
          <select value={comparison.id} onChange={(event) => { setComparisonId(event.target.value); onSelectionChange() }}>
            {otherVersions.map((run) => <option value={run.id} key={run.id}>
              {run.checklist.version_id} · {t('runNumber', { id: runs.length - runs.findIndex((item) => item.id === run.id) })}
            </option>)}
          </select>
        </label>
        <RunSummary evaluation={comparison} />
      </div>
    </div>
    <label className="checkbox-field comparison-filter"><input type="checkbox" checked={onlyChanges}
      onChange={(event) => { setOnlyChanges(event.target.checked); onSelectionChange() }} /> {t('changedCriteriaOnly')}</label>
    <ol className="comparison-rows">
      {visibleRows.map((row) => <li className={`comparison-row${row.changes.length ? ' comparison-row-changed' : ''}`} key={row.id}>
        <div className="comparison-row-heading"><span className="criterion-id">{row.id}</span>
          {row.changes.length ? row.changes.map((change) => <span className="comparison-change" key={change}>{t(change)}</span>) : <span className="comparison-unchanged">{t('unchanged')}</span>}
        </div>
        <div className="comparison-columns">
          <ComparedGrade criterion={row.before} item={row.beforeGrade} evaluation={reference} turns={turns} target={target} onEvidence={onEvidence} />
          <ComparedGrade criterion={row.after} item={row.afterGrade} evaluation={comparison} turns={turns} target={target} onEvidence={onEvidence} />
        </div>
      </li>)}
    </ol>
    {!visibleRows.length && <p className="comparison-note" role="status">{t('noCriterionDifferences')}</p>}
  </section>
}
