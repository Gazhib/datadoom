import { gradeLabel } from '../../../entities/quality'
import type { Conversation, Evaluation, Score } from '../../../entities/quality'
import { ReviewCriterion } from '../../../features/review-criterion'
import { Icon } from '../../../shared/ui/Icon'
import { EvidenceLinks } from './EvidenceLinks'
import type { EvidenceTarget } from './Transcript'

const points = (value: number | null) => value === null ? '—' : value.toFixed(2)

function ScoreOverview({ score, itemCount }: { score: Score; itemCount: number }) {
  return <div className="score-overview">
    <div className="score-copy">
      <p className="kicker">Overall quality</p>
      <div className="score-number">{points(score.total)}<span>{score.total !== null && '/ 100'}</span></div>
      <p className="score-caption">{score.total === null ? 'No applicable weighted criteria' : `${itemCount} ${itemCount === 1 ? 'criterion' : 'criteria'} evaluated`}</p>
      <span className={`flag-label${score.serious_error ? ' flag-raised' : ''}`}><Icon name={score.serious_error ? 'flag' : 'shield'} size={13} /> {score.serious_error ? 'Serious error flagged' : 'No serious errors'}</span>
    </div>
    {score.total !== null && <div className="score-dial" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none">
        <circle cx="60" cy="60" r="57" className="dial-ticks" pathLength="100" strokeDasharray=".45 2.675" />
        <circle cx="60" cy="60" r="46" className="dial-track" />
        {score.total > 0 && <circle cx="60" cy="60" r="46" className="dial-progress" pathLength="100" strokeDasharray={`${score.total} 100`} transform="rotate(-90 60 60)" />}
      </svg>
      <span className="dial-center"><Icon name="waveform" size={26} /><span>QUALITY</span></span>
    </div>}
  </div>
}

export function Results({ evaluation, conversation, target, running, onEvidence, onUpdated }: {
  evaluation: Evaluation
  conversation: Conversation
  target: EvidenceTarget | null
  running: boolean
  onEvidence: (target: EvidenceTarget) => void
  onUpdated: (evaluation: Evaluation) => void
}) {
  const { checklist, original, final, model, appeals } = evaluation
  const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]))
  const criteriaById = new Map(checklist.criteria.map((criterion) => [criterion.id, criterion]))
  const originalById = new Map(original.items.map((item) => [item.criterion_id, item]))
  const appealsById = new Map(appeals.map((appeal) => [appeal.criterion_id, appeal]))

  return <>
    <ScoreOverview score={final} itemCount={final.items.length} />
    {appeals.some((appeal) => appeal.status === 'resolved') && <dl className="review-totals" aria-label="Review score comparison">
      <div><dt>Original total</dt><dd>{points(original.total)}</dd></div>
      <div><dt>Final total</dt><dd>{points(final.total)}</dd></div>
    </dl>}
    <div className="result-meta">
      <span className="version-chip">{checklist.version_id}</span>
      <span className="model-label">{model.provider} / {model.model}</span>
      <span className={`mode-badge ${evaluation.mode === 'fixture' ? 'mode-synthetic' : 'mode-live'}`}>{evaluation.mode === 'fixture' ? 'Synthetic result' : 'Live result'}</span>
      <span className="run-identifier">Run {evaluation.id}</span>
    </div>
    {final.sections.length > 0 && <details className="section-breakdown">
      <summary><Icon name="layers" size={17} /> Section scores <Icon name="down" size={16} /></summary>
      <dl>
        {final.sections.map((section) => <div key={section.name}><dt>{section.name}</dt><dd>{points(section.points)} / {points(section.possible)}</dd></div>)}
      </dl>
    </details>}
    <div className="criteria-heading"><div><p className="kicker">The details behind the score</p><h3>Criterion grades</h3></div><span>{final.items.length} criteria</span></div>
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
