import { useI18n } from '../../../shared/i18n/useI18n'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CriterionVotes, gradeLabel, isSplitVote } from '../../../entities/quality'
import type { Conversation, Evaluation, Score } from '../../../entities/quality'
import { ReviewCriterion } from '../../../features/review-criterion'
import { Icon } from '../../../shared/ui/Icon'
import { EvidenceLinks } from './EvidenceLinks'
import { JudgePanel } from './JudgePanel'
import type { EvidenceTarget } from './Transcript'

const deduction = (item: Score['items'][number]) => (item.effective_weight ?? 0) - (item.points ?? 0)

export function Results({ evaluation, conversation, target, onEvidence, onUpdated, comparison }: {
  evaluation: Evaluation
  conversation: Conversation
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget | null) => void
  onUpdated: (evaluation: Evaluation) => void
  comparison?: ReactNode
}) {
  const { locale, t } = useI18n()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const points = (value: number | null) => value === null ? '—' : number.format(value)
  const { checklist, original, final, model, appeals } = evaluation
  const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]))
  const criteriaById = new Map(checklist.criteria.map((criterion) => [criterion.id, criterion]))
  const originalById = new Map(original.items.map((item) => [item.criterion_id, item]))
  const appealsById = new Map(appeals.map((appeal) => [appeal.criterion_id, appeal]))
  const [focusedId, setFocusedId] = useState('')
  const [splitOnly, setSplitOnly] = useState(false)
  const votesById = new Map(evaluation.panel?.votes.map((vote) => [vote.criterion_id, vote]) ?? [])
  const visibleItems = final.items.filter((item) => !evaluation.panel || !splitOnly ||
    (votesById.has(item.criterion_id) && isSplitVote(votesById.get(item.criterion_id)!)))
  const ranked = final.items.filter((item) => criteriaById.get(item.criterion_id)?.kind !== 'flag')
    .sort((a, b) => deduction(b) - deduction(a) || (b.points ?? 0) - (a.points ?? 0))
  const featured = ranked.slice(0, 3)
  const focused = featured.find((item) => item.criterion_id === focusedId) ?? featured[0]
  const focusedCriterion = focused && criteriaById.get(focused.criterion_id)
  const focusedOriginal = focused && originalById.get(focused.criterion_id)
  const focusedEvidence = focused?.evidence_turn_ids.map((id) => turnsById.get(id)).filter((turn) => !!turn)
  const evidence = focusedEvidence?.filter((turn) => turn.speaker === 'operator').at(-1) ?? focusedEvidence?.at(-1)

  return <>
    <div className="score-summary">
      <div className="score-summary-heading">
        <span className="score-caption">{t('finalScore')}</span>
        <span className={`flag-label${final.serious_error ? ' flag-raised' : ''}`}><Icon name={final.serious_error ? 'flag' : 'shield'} size={15} /> {final.serious_error ? t('seriousErrorFlagged') : t('noSeriousErrors')}</span>
      </div>
      <p className="score-value">{final.total === null ? <span>{t('noScore')}</span> : <><strong>{points(final.total)}</strong> <span>/ 100</span></>}</p>
      {final.total !== null && <div className="score-scale" aria-hidden="true">
        <div className="score-track"><span style={{ width: `${final.total}%` }} /></div>
        <div className="score-ticks">{[0, 25, 50, 75, 100].map((tick) => <span key={tick}>{tick}</span>)}</div>
      </div>}
    </div>
    {featured.length > 0 && <div className="score-overview">
      <h3>{t('keyCriteria')}</h3>
      <ul className="score-highlights" aria-label={t('featuredCriteria')}>
        {featured.map((item) => {
          const status = item.value === 'na' ? 'na' : item.points === 0 ? 'missed' : deduction(item) > .01 ? 'partial' : 'met'
          return <li key={item.criterion_id}><button className="score-highlight" type="button" aria-pressed={focused?.criterion_id === item.criterion_id}
            onClick={() => {
              setFocusedId(item.criterion_id)
              if (target?.source === 'overview' && target.criterionId !== item.criterion_id) onEvidence(null)
            }}>
            <span className={`highlight-status highlight-${status}`}><Icon name={status === 'met' ? 'check' : status === 'missed' ? 'close' : 'minus'} size={16} /></span>
            <span className="highlight-name">{criteriaById.get(item.criterion_id)?.label ?? item.criterion_id}<span className="sr-only"> · {status === 'na' ? t('notApplicable') : status === 'missed' ? t('notMet') : status === 'partial' ? t('partiallyMet') : t('met')}</span></span>
            <span className="highlight-points"><strong>{points(item.points)}</strong>{item.effective_weight !== null && ` / ${points(item.effective_weight)}`}</span>
          </button></li>
        })}
      </ul>
    </div>}
    {focused && <div className="score-explanation">
      <h3>{deduction(focused) > .01 ? t('deductionExplanation') : focused.value === 'na' ? t('naExplanation') : t('scoreExplanation')}</h3>
      <p lang={conversation.language === 'RU' && evaluation.mode === 'fixture' ? 'ru' : undefined}>{focused.reason}</p>
      <div className="score-actions">
        {evidence && <button type="button" className="button button-primary" onClick={(event) => onEvidence({
          id: evidence.id, criterionId: focused.criterion_id, source: 'overview', origin: event.currentTarget,
        })}><Icon name="link" size={17} /> {t('goToEvidence')}</button>}
        {focusedCriterion && focusedOriginal && <ReviewCriterion key={focusedCriterion.id} compact evaluationId={evaluation.id}
          criterion={focusedCriterion} original={focusedOriginal} vote={votesById.get(focusedCriterion.id)} appeal={appealsById.get(focusedCriterion.id)} turns={conversation.turns} disabled={false} onUpdated={onUpdated} />}
      </div>
    </div>}
    {appeals.some((appeal) => appeal.status === 'resolved') && <dl className="review-totals" aria-label={t('reviewScoreComparison')}>
      <div><dt>{t('originalTotal')}</dt><dd>{points(original.total)}</dd></div>
      <div><dt>{t('finalTotal')}</dt><dd>{points(final.total)}</dd></div>
    </dl>}
    <div className="result-tools">
      <div className="result-meta">
        <span className="version-chip">{checklist.version_id}</span>
        <span className={`mode-badge ${evaluation.mode === 'fixture' ? 'mode-synthetic' : 'mode-live'}`}>{evaluation.mode === 'fixture' ? t('demoResult') : t('liveResult')}</span>
        <span className="model-label">{model.provider} / {model.model}</span>
        <span className="run-identifier">{t('runReference', { id: evaluation.id })}</span>
      </div>
      {comparison}
    </div>
    {final.sections.length > 0 && <details className="section-breakdown">
      <summary><Icon name="layers" size={17} /> {t('sectionScores')} <Icon name="down" size={16} /></summary>
      <dl>
        {final.sections.map((section) => <div key={section.name}><dt>{section.name}</dt><dd>{points(section.points)} / {points(section.possible)}</dd></div>)}
      </dl>
    </details>}
    {evaluation.panel && <JudgePanel panel={evaluation.panel} splitOnly={splitOnly} onSplitOnly={setSplitOnly} />}
    <div className="criteria-heading"><h3>{t('criterionGrades')}</h3><span>{t('criteriaCount', { count: visibleItems.length })}{splitOnly && evaluation.panel && ` · ${t('splitOnly')}`}</span></div>
    {!visibleItems.length && <p className="empty-detail">{t('allJudgesAgree')}</p>}
    <ol className="criteria-list">
      {visibleItems.map((item) => {
        const criterion = criteriaById.get(item.criterion_id)
        const originalGrade = originalById.get(item.criterion_id)
        const appeal = appealsById.get(item.criterion_id)
        const changed = appeal?.decision?.action === 'change'
        const gradeStyle = item.value === 'na' ? 'grade-na' : typeof item.value === 'number' ? 'grade-scale'
          : (item.value === 'yes') !== (criterion?.kind === 'flag') ? 'grade-positive' : 'grade-negative'

        const vote = votesById.get(item.criterion_id)
        return <li className={`criterion${vote && isSplitVote(vote) ? ' criterion-split' : ''}`} key={item.criterion_id}>
          <div className="criterion-title">
            <span className="criterion-id">{item.criterion_id}</span>
            <h4>{criterion?.label ?? item.criterion_id}</h4>
            <span className={`grade-pill ${gradeStyle}`}>{changed ? t('finalGrade', { grade: gradeLabel(item.value, criterion, t) }) : gradeLabel(item.value, criterion, t)}</span>
          </div>
          <div className="weight-row"><span>{t('weight')} <strong>{item.weight}</strong></span><span>{t('effectiveWeight')} <strong>{item.effective_weight === null ? '—' : `${points(item.effective_weight)}%`}</strong></span><span>{t('points')} <strong>{points(item.points)}</strong></span></div>
          <p className="criterion-reason">{item.reason}</p>
          {criterion && <CriterionVotes criterion={criterion} vote={vote} />}
          <EvidenceLinks grade={item} turns={turnsById} target={target} onEvidence={onEvidence} />
          {changed && originalGrade && <div className="original-grade">
            <strong>{t('originalGradePoints', { grade: gradeLabel(originalGrade.value, criterion, t), points: points(originalGrade.points) })}</strong>
            <p className="criterion-reason">{originalGrade.reason}</p>
            <EvidenceLinks grade={originalGrade} turns={turnsById} target={target} original onEvidence={onEvidence} />
          </div>}
          {criterion && <details className="scoring-rule">
            <summary>{t('scoringRule')}</summary>
            <p>{criterion.instruction}</p>
            {criterion.na_rule && <p><strong>{t('na')}</strong> {criterion.na_rule}</p>}
          </details>}
          {criterion && originalGrade && <ReviewCriterion evaluationId={evaluation.id} criterion={criterion} original={originalGrade}
            appeal={appeal} vote={vote} turns={conversation.turns} disabled={false} onUpdated={onUpdated} />}
        </li>
      })}
    </ol>
  </>
}
