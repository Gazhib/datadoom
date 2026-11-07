import type { Conversation, Evaluation, Score } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import type { EvidenceTarget } from './Transcript'

const points = (value: number | null) => value === null ? '—' : value.toFixed(2)

function ScoreOverview({ score, itemCount }: { score: Score; itemCount: number }) {
  return <div className="score-overview">
    <div className="score-copy">
      <p className="kicker">Overall quality</p>
      <div className="score-number">{points(score.total)}<span>{score.total !== null && '/ 100'}</span></div>
      <p className="score-caption">{itemCount} {itemCount === 1 ? 'criterion' : 'criteria'} evaluated</p>
      <span className={`flag-label${score.serious_error ? ' flag-raised' : ''}`}><Icon name="flag" size={15} /> {score.serious_error ? 'Serious error flagged' : 'No serious errors'}</span>
    </div>
    {score.total !== null && <div className="score-dial" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none">
        <circle cx="60" cy="60" r="57" className="dial-ticks" pathLength="100" strokeDasharray=".45 2.675" />
        <circle cx="60" cy="60" r="46" className="dial-track" />
        {score.total > 0 && <circle cx="60" cy="60" r="46" className="dial-progress" pathLength="100" strokeDasharray={`${score.total} 100`} transform="rotate(-90 60 60)" />}
      </svg>
      <Icon name="activity" size={34} />
    </div>}
  </div>
}

export function Results({ evaluation, conversation, target, onEvidence }: {
  evaluation: Evaluation
  conversation: Conversation
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget) => void
}) {
  const { checklist, final, model } = evaluation
  const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]))
  const criteriaById = new Map(checklist.criteria.map((criterion) => [criterion.id, criterion]))

  return <>
    <ScoreOverview score={final} itemCount={final.items.length} />
    <div className="result-meta">
      <span className="version-chip">{checklist.version_id}</span>
      <span className="model-label">{model.provider} / {model.model}</span>
      {evaluation.mode === 'fixture' && <span className="mode-badge mode-synthetic">Synthetic result</span>}
    </div>
    {final.sections.length > 0 && <details className="section-breakdown">
      <summary><Icon name="layers" size={17} /> Section scores <Icon name="down" size={16} /></summary>
      <dl>
        {final.sections.map((section) => <div key={section.name}><dt>{section.name}</dt><dd>{points(section.points)} / {points(section.possible)}</dd></div>)}
      </dl>
    </details>}
    <div className="criteria-heading"><h3>Criterion grades</h3><span>{checklist.name}</span></div>
    <ol className="criteria-list">
      {final.items.map((item) => {
        const criterion = criteriaById.get(item.criterion_id)
        const value = typeof item.value === 'number' && criterion?.scale.length
          ? `${item.value} / ${Math.max(...criterion.scale)}`
          : { yes: 'Yes', no: 'No', na: 'N/A' }[item.value] ?? String(item.value)
        const gradeStyle = item.value === 'na' ? 'grade-na' : typeof item.value === 'number' ? 'grade-scale'
          : (item.value === 'yes') !== (criterion?.kind === 'flag') ? 'grade-positive' : 'grade-negative'

        return <li className="criterion" key={item.criterion_id}>
          <div className="criterion-title"><span className="criterion-id">{item.criterion_id}</span><h4>{criterion?.label ?? item.criterion_id}</h4><span className={`grade-pill ${gradeStyle}`}>{value}</span></div>
          <div className="weight-row"><span>Weight <strong>{item.weight}</strong></span><span>Effective <strong>{item.effective_weight === null ? '—' : `${points(item.effective_weight)}%`}</strong></span><span>Points <strong>{points(item.points)}</strong></span></div>
          <p className="criterion-reason">{item.reason}</p>
          <div className="evidence-links">
            {item.evidence_turn_ids.map((id) => {
              const turn = turnsById.get(id)
              const current = target?.id === id && target.criterionId === item.criterion_id
              return turn && <button className="evidence-link" type="button" key={id} aria-current={current ? 'true' : undefined} onClick={(event) => onEvidence({ id, criterionId: item.criterion_id, origin: event.currentTarget })} aria-label={`Show ${item.criterion_id} evidence, turn ${id} at ${turn.timestamp}`}>
                <Icon name="link" size={15} /> <span>{id} · {turn.timestamp}</span><Icon name="arrowUpRight" size={13} />
              </button>
            })}
          </div>
        </li>
      })}
    </ol>
  </>
}
