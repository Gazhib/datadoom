import { useI18n } from '../../../shared/i18n/useI18n'
import type { Criterion, PanelVote } from '../model/contract'
import { gradeLabel } from '../model/rubric'
import './criterion-votes.css'

export function isSplitVote(vote: PanelVote) {
  return new Set(Object.values(vote.ballots)).size > 1
}

export function CriterionVotes({ vote, criterion }: { vote?: PanelVote; criterion: Criterion }) {
  const { t } = useI18n()
  if (!vote) return null
  const split = isSplitVote(vote)
  return <div className={`criterion-votes${split ? ' criterion-votes-split' : ''}`} aria-label={t('judgeVotes', { criterion: criterion.label })}>
    <span className="vote-caption">{split ? t('splitDecision') : t('judgesAgree')}</span>
    <div className="vote-chips">
      {Object.entries(vote.ballots).map(([name, value]) => <span className="vote-chip" key={name}
        aria-label={`${name}: ${gradeLabel(value, criterion, t)}`}>
        <span>{name}</span><strong>{gradeLabel(value, criterion, t)}</strong>
      </span>)}
    </div>
  </div>
}
