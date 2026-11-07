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
  return <div className="comparison-summary">
    <div className="comparison-version">
      <span className="version-chip">{evaluation.checklist.version_id}</span>
      <span className={`mode-badge ${evaluation.mode === 'fixture' ? 'mode-synthetic' : 'mode-live'}`}>
        {evaluation.mode === 'fixture' ? 'Synthetic result' : 'Live result'}
      </span>
    </div>
    <p>{evaluation.checklist.name}</p>
    <dl className="comparison-totals">
      <div><dt>Original total</dt><dd>{points(evaluation.original.total)}</dd></div>
      <div><dt>Final total</dt><dd>{points(evaluation.final.total)}</dd></div>
    </dl>
    <p className={evaluation.final.serious_error ? 'comparison-flag' : 'comparison-no-flag'}>
      <Icon name={evaluation.final.serious_error ? 'flag' : 'shield'} size={14} />
      {evaluation.final.serious_error ? 'Serious error flagged' : 'No serious errors'}
    </p>
    {evaluation.final.total === null && <p className="form-note">No applicable weighted criteria.</p>}
    <p className="run-identifier">Run {evaluation.id}</p>
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
  if (!criterion || !item) return <div className="comparison-grade comparison-missing">
    <p>Not included in {evaluation.checklist.version_id}.</p>
  </div>

  const appeal = evaluation.appeals.find(({ criterion_id }) => criterion_id === criterion.id)
  const original = evaluation.original.items.find(({ criterion_id }) => criterion_id === criterion.id)

  return <div className="comparison-grade">
    <p className="comparison-cell-version">{evaluation.checklist.version_id}</p>
    <div className="comparison-grade-heading"><h4>{criterion.label}</h4><strong>{gradeLabel(item.value, criterion)}</strong></div>
    <div className="weight-row">
      <span>Weight <strong>{item.weight}</strong></span>
      <span>Effective <strong>{item.effective_weight === null ? '—' : `${points(item.effective_weight)}%`}</strong></span>
      <span>Points <strong>{points(item.points)}</strong></span>
    </div>
    <p className="criterion-reason">{item.reason}</p>
    <EvidenceLinks grade={item} turns={turns} target={target} source={evaluation.id} onEvidence={onEvidence} />
    {appeal?.status === 'resolved' && <div className="comparison-decision">
      <p><strong>{appeal.decision?.action === 'change' ? 'Grade changed' : 'Grade confirmed'}</strong>
        {original && ` · Original ${gradeLabel(original.value, criterion)}`}</p>
      <p><strong>Appeal comment</strong> {appeal.comment}</p>
      <p><strong>Decision reason</strong> {appeal.decision?.reason}</p>
    </div>}
    <details className="scoring-rule">
      <summary>Saved scoring rule</summary>
      <p>{criterion.instruction}</p>
      <p><strong>Answer type</strong> {criterion.kind}{criterion.kind === 'scale' && ` · ${criterion.scale.join(', ')}`}</p>
      {criterion.na_rule && <p><strong>N/A</strong> {criterion.na_rule}</p>}
      {criterion.section && <p><strong>Section</strong> {criterion.section}</p>}
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
    <Icon name="layers" size={22} /><h3 id={headingId}>Compare checklist versions</h3>
    <p>Save another checklist version, select it above, and run an evaluation on this conversation. Then compare both saved results here.</p>
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
    const changes: string[] = []
    if (!before) changes.push('Criterion added')
    else if (!after) changes.push('Criterion removed')
    else {
      if (ruleSignature(before) !== ruleSignature(after)) changes.push('Rule changed')
      if (beforeGrade?.value !== afterGrade?.value) changes.push('Grade changed')
      if (beforeGrade?.points !== afterGrade?.points || beforeGrade?.effective_weight !== afterGrade?.effective_weight) changes.push('Points changed')
      if (beforeGrade?.reason !== afterGrade?.reason) changes.push('Rationale changed')
      const beforeEvidence = [...(beforeGrade?.evidence_turn_ids ?? [])].sort()
      const afterEvidence = [...(afterGrade?.evidence_turn_ids ?? [])].sort()
      if (JSON.stringify(beforeEvidence) !== JSON.stringify(afterEvidence)) changes.push('Evidence changed')
    }
    return { id, before, after, beforeGrade, afterGrade, changes }
  })
  const changedCount = rows.filter((row) => row.changes.length).length
  const visibleRows = onlyChanges ? rows.filter((row) => row.changes.length) : rows

  return <section className="run-comparison" aria-labelledby={headingId}>
    <div className="comparison-heading">
      <div><p className="kicker">Same conversation · Saved results</p><h3 id={headingId}>Compare checklist versions</h3></div>
      <p className="comparison-count" role="status">{changedCount} of {rows.length} criteria differ</p>
    </div>
    <p className="comparison-note">Each column uses its saved checklist and reviewed final grades. Different weights or N/A rules can change points even when a grade stays the same.</p>
    <div className="comparison-columns">
      <div>
        <label className="field"><span className="field-label">Reference evaluation</span>
          <select value={reference.id} onChange={(event) => { setReferenceId(event.target.value); onSelectionChange() }}>
            {runs.map((run, index) => <option value={run.id} key={run.id}>
              {run.checklist.version_id} · {index === 0 ? 'Latest run' : `Run ${runs.length - index}`}
            </option>)}
          </select>
        </label>
        <RunSummary evaluation={reference} />
      </div>
      <div>
        <label className="field"><span className="field-label">Comparison evaluation</span>
          <select value={comparison.id} onChange={(event) => { setComparisonId(event.target.value); onSelectionChange() }}>
            {otherVersions.map((run) => <option value={run.id} key={run.id}>
              {run.checklist.version_id} · Run {runs.length - runs.findIndex((item) => item.id === run.id)}
            </option>)}
          </select>
        </label>
        <RunSummary evaluation={comparison} />
      </div>
    </div>
    <label className="checkbox-field comparison-filter"><input type="checkbox" checked={onlyChanges}
      onChange={(event) => { setOnlyChanges(event.target.checked); onSelectionChange() }} /> Show changed criteria only</label>
    <ol className="comparison-rows">
      {visibleRows.map((row) => <li className={`comparison-row${row.changes.length ? ' comparison-row-changed' : ''}`} key={row.id}>
        <div className="comparison-row-heading"><span className="criterion-id">{row.id}</span>
          {row.changes.length ? row.changes.map((change) => <span className="comparison-change" key={change}>{change}</span>) : <span className="comparison-unchanged">Unchanged</span>}
        </div>
        <div className="comparison-columns">
          <ComparedGrade criterion={row.before} item={row.beforeGrade} evaluation={reference} turns={turns} target={target} onEvidence={onEvidence} />
          <ComparedGrade criterion={row.after} item={row.afterGrade} evaluation={comparison} turns={turns} target={target} onEvidence={onEvidence} />
        </div>
      </li>)}
    </ol>
    {!visibleRows.length && <p className="comparison-note" role="status">No criterion differences between these saved results.</p>}
  </section>
}
