import { useState } from 'react'
import type { ReactNode } from 'react'
import { gradeLabel } from '../../../entities/quality'
import type { Conversation, Evaluation, Score } from '../../../entities/quality'
import { ReviewCriterion } from '../../../features/review-criterion'
import { Icon } from '../../../shared/ui/Icon'
import { EvidenceLinks } from './EvidenceLinks'
import type { EvidenceTarget } from './Transcript'

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const points = (value: number | null) => value === null ? '—' : number.format(value)
const deduction = (item: Score['items'][number]) => (item.effective_weight ?? 0) - (item.points ?? 0)

function ScoreDial({ total }: { total: Score['total'] }) {
  return <div className="score-dial">
      <svg viewBox="0 0 144 144" fill="none" aria-hidden="true">
        <circle cx="72" cy="72" r="65" className="dial-track" />
        {total !== null && total > 0 && <circle cx="72" cy="72" r="65" className="dial-progress" pathLength="100" strokeDasharray={`${total} 100`} transform="rotate(-90 72 72)" />}
      </svg>
      <div className="dial-center"><strong>{points(total)}</strong><span>{total === null ? 'No score' : '/ 100'}</span></div>
  </div>
}

export function Results({ evaluation, conversation, target, running, onEvidence, onUpdated, comparison }: {
  evaluation: Evaluation
  conversation: Conversation
  target: EvidenceTarget | null
  running: boolean
  onEvidence: (target: EvidenceTarget | null) => void
  onUpdated: (evaluation: Evaluation) => void
  comparison?: ReactNode
}) {
  const { checklist, original, final, model, appeals } = evaluation
  const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]))
  const criteriaById = new Map(checklist.criteria.map((criterion) => [criterion.id, criterion]))
  const originalById = new Map(original.items.map((item) => [item.criterion_id, item]))
  const appealsById = new Map(appeals.map((appeal) => [appeal.criterion_id, appeal]))
  const [focusedId, setFocusedId] = useState('')
  const ranked = final.items.filter((item) => criteriaById.get(item.criterion_id)?.kind !== 'flag')
    .sort((a, b) => deduction(b) - deduction(a) || (b.points ?? 0) - (a.points ?? 0))
  const featured = ranked.slice(0, 3)
  const focused = featured.find((item) => item.criterion_id === focusedId) ?? featured[0]
  const focusedCriterion = focused && criteriaById.get(focused.criterion_id)
  const focusedOriginal = focused && originalById.get(focused.criterion_id)
  const focusedEvidence = focused?.evidence_turn_ids.map((id) => turnsById.get(id)).filter((turn) => !!turn)
  const evidence = focusedEvidence?.filter((turn) => turn.speaker === 'operator').at(-1) ?? focusedEvidence?.at(-1)

  return <>
    <div className="score-overview">
      <ScoreDial total={final.total} />
      <ul className="score-highlights" aria-label="Featured criteria">
        {featured.map((item) => {
          const status = item.value === 'na' ? 'na' : item.points === 0 ? 'missed' : deduction(item) > .01 ? 'partial' : 'met'
          return <li key={item.criterion_id}><button className="score-highlight" type="button" aria-pressed={focused?.criterion_id === item.criterion_id}
            onClick={() => {
              setFocusedId(item.criterion_id)
              if (target?.source === 'overview' && target.criterionId !== item.criterion_id) onEvidence(null)
            }}>
            <span className={`highlight-status highlight-${status}`}><Icon name={status === 'met' ? 'check' : status === 'missed' ? 'close' : 'minus'} size={16} /></span>
            <span className="highlight-name">{criteriaById.get(item.criterion_id)?.label ?? item.criterion_id}<span className="sr-only"> · {status === 'na' ? 'Not applicable' : status === 'missed' ? 'Not met' : status === 'partial' ? 'Partially met' : 'Met'}</span></span>
            <span className="highlight-points"><strong>{points(item.points)}</strong>{item.effective_weight !== null && ` / ${points(item.effective_weight)}`}</span>
          </button></li>
        })}
      </ul>
    </div>
    {focused && <div className="score-explanation">
      <h3>{deduction(focused) > .01 ? 'Why points were deducted' : focused.value === 'na' ? 'Why this criterion does not apply' : 'How this criterion was scored'}</h3>
      <p lang={conversation.language === 'RU' && evaluation.mode === 'fixture' ? 'ru' : undefined}>{focused.reason}</p>
      <div className="score-actions">
        {evidence && <button type="button" className="button button-primary" onClick={(event) => onEvidence({
          id: evidence.id, criterionId: focused.criterion_id, source: 'overview', origin: event.currentTarget,
        })}><Icon name="link" size={17} /> Go to evidence</button>}
        {focusedCriterion && focusedOriginal && <ReviewCriterion key={focusedCriterion.id} compact evaluationId={evaluation.id}
          criterion={focusedCriterion} original={focusedOriginal} appeal={appealsById.get(focusedCriterion.id)} turns={conversation.turns} disabled={running} onUpdated={onUpdated} />}
      </div>
    </div>}
    <div className="score-provenance">
      <span className={`flag-label${final.serious_error ? ' flag-raised' : ''}`}><Icon name={final.serious_error ? 'flag' : 'shield'} size={16} /> {final.serious_error ? 'Serious error flagged' : 'No serious errors'}</span>
      <span className={`mode-badge ${evaluation.mode === 'fixture' ? 'mode-synthetic' : 'mode-live'}`}>{evaluation.mode === 'fixture' ? 'Synthetic result' : 'Live result'}</span>
    </div>
    {appeals.some((appeal) => appeal.status === 'resolved') && <dl className="review-totals" aria-label="Review score comparison">
      <div><dt>Original total</dt><dd>{points(original.total)}</dd></div>
      <div><dt>Final total</dt><dd>{points(final.total)}</dd></div>
    </dl>}
    <div className="result-tools">
      <div className="result-meta">
        <span className="version-chip">{checklist.version_id}</span>
        <span className="model-label">{model.provider} / {model.model}</span>
        <span className="run-identifier">Run {evaluation.id}</span>
      </div>
      {comparison}
    </div>
    {final.sections.length > 0 && <details className="section-breakdown">
      <summary><Icon name="layers" size={17} /> Section scores <Icon name="down" size={16} /></summary>
      <dl>
        {final.sections.map((section) => <div key={section.name}><dt>{section.name}</dt><dd>{points(section.points)} / {points(section.possible)}</dd></div>)}
      </dl>
    </details>}
    <div className="criteria-heading"><h3>Criterion grades</h3><span>{final.items.length} criteria</span></div>
    <ol className="criteria-list">
      {final.items.map((item) => {
        const criterion = criteriaById.get(item.criterion_id)
        const originalGrade = originalById.get(item.criterion_id)
        const appeal = appealsById.get(item.criterion_id)
        const changed = appeal?.decision?.action === 'change'
        const gradeStyle = item.value === 'na' ? 'grade-na' : typeof item.value === 'number' ? 'grade-scale'
          : (item.value === 'yes') !== (criterion?.kind === 'flag') ? 'grade-positive' : 'grade-negative'

        return <li className="criterion" key={item.criterion_id}>
          <div className="criterion-title">
            <span className="criterion-id">{item.criterion_id}</span>
            <h4>{criterion?.label ?? item.criterion_id}</h4>
            <span className={`grade-pill ${gradeStyle}`}>{changed && 'Final '}{gradeLabel(item.value, criterion)}</span>
          </div>
          <div className="weight-row"><span>Weight <strong>{item.weight}</strong></span><span>Effective <strong>{item.effective_weight === null ? '—' : `${points(item.effective_weight)}%`}</strong></span><span>Points <strong>{points(item.points)}</strong></span></div>
          <p className="criterion-reason">{item.reason}</p>
          <EvidenceLinks grade={item} turns={turnsById} target={target} onEvidence={onEvidence} />
          {changed && originalGrade && <div className="original-grade">
            <strong>Original grade {gradeLabel(originalGrade.value, criterion)} · {points(originalGrade.points)} points</strong>
            <p className="criterion-reason">{originalGrade.reason}</p>
            <EvidenceLinks grade={originalGrade} turns={turnsById} target={target} original onEvidence={onEvidence} />
          </div>}
          {criterion && <details className="scoring-rule">
            <summary>Scoring rule</summary>
            <p>{criterion.instruction}</p>
            {criterion.na_rule && <p><strong>N/A</strong> {criterion.na_rule}</p>}
          </details>}
          {criterion && originalGrade && <ReviewCriterion evaluationId={evaluation.id} criterion={criterion} original={originalGrade}
            appeal={appeal} turns={conversation.turns} disabled={running} onUpdated={onUpdated} />}
        </li>
      })}
    </ol>
  </>
}
