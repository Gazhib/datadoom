import type { Criterion, PanelVote } from '../model/contract'
import { gradeLabel } from '../model/rubric'
import './criterion-votes.css'

export function isSplitVote(vote: PanelVote) {
  return new Set(Object.values(vote.ballots)).size > 1
}

export function CriterionVotes({ vote, criterion }: { vote?: PanelVote; criterion: Criterion }) {
  if (!vote) return null
  const split = isSplitVote(vote)
  return <div className={`criterion-votes${split ? ' criterion-votes-split' : ''}`} aria-label={`Judge votes for ${criterion.label}`}>
    <span className="vote-caption">{split ? 'Split decision' : 'Judges agree'}</span>
    <div className="vote-chips">
      {Object.entries(vote.ballots).map(([name, value]) => <span className="vote-chip" key={name}
        aria-label={`${name}: ${gradeLabel(value, criterion)}`}>
        <span>{name}</span><strong>{gradeLabel(value, criterion)}</strong>
      </span>)}
    </div>
  </div>
}
