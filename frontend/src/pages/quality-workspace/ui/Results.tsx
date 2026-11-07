import type { Conversation, Evaluation, Score } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'

const points = (value: number | null) => value === null ? '—' : value.toFixed(2)

function ScoreOverview({ score, itemCount }: { score: Score; itemCount: number }) {
  return <div className="score-overview">
    <div>
      <p className="kicker">Overall quality</p>
      <div className="score-number">{points(score.total)}<span>{score.total !== null && '/ 100'}</span></div>
      <p className="score-caption">{itemCount} {itemCount === 1 ? 'criterion' : 'criteria'} evaluated</p>
    </div>
    <div className="score-side">
      <span className={`flag-label${score.serious_error ? ' flag-raised' : ''}`}><Icon name="flag" size={15} /> {score.serious_error ? 'Serious error flagged' : 'No serious errors'}</span>
      {score.total !== null && <meter min="0" max="100" value={score.total} aria-label="Overall quality" />}
    </div>
  </div>
}

export function Results({ evaluation, conversation, onEvidence }: { evaluation: Evaluation; conversation: Conversation; onEvidence: (id: string) => void }) {
  const { checklist, final, model } = evaluation
  const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]))
  const criteriaById = new Map(checklist.criteria.map((criterion) => [criterion.id, criterion]))

  return <>
    <div className="result-meta">
      <span className="version-chip">{checklist.version_id}</span>
      <span className="model-label">{model.provider} / {model.model}</span>
      {evaluation.mode === 'fixture' && <span className="mode-badge mode-synthetic">Synthetic result</span>}
    </div>
    <ScoreOverview score={final} itemCount={final.items.length} />
    {final.sections.length > 0 && <details className="section-breakdown">
      <summary>Section scores <Icon name="down" size={16} /></summary>
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
              return turn && <button className="evidence-link" type="button" key={id} onClick={() => onEvidence(id)} aria-label={`Show ${item.criterion_id} evidence, turn ${id} at ${turn.timestamp}`}>
                <Icon name="link" size={14} /> <span>{id} · {turn.timestamp}</span>
              </button>
            })}
          </div>
        </li>
      })}
    </ol>
  </>
}
