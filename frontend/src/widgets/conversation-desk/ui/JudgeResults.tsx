import { useI18n } from '../../../shared/i18n/useI18n'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { gradeLabel } from '../../../entities/quality'
import type { Checklist, EvaluationJob, Turn } from '../../../entities/quality'
import { EvidenceLinks } from './EvidenceLinks'
import type { EvidenceTarget } from './Transcript'

export function JudgeResults({ job, checklist, turns, target, onEvidence }: {
  job: EvaluationJob
  checklist?: Checklist
  turns: Map<string, Turn>
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget | null) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [selectedName, setSelectedName] = useState('')
  const ended = job.status === 'succeeded' || job.status === 'failed'
  const judges = (job.progress?.judges ?? []).map((judge) => ({
    ...judge,
    displayStatus: ended && (judge.status === 'pending' || judge.status === 'running') ? 'unavailable' as const : judge.status,
  }))
  const selected = judges.find((judge) => judge.name === selectedName) ?? judges[0]
  const criteria = new Map(checklist?.criteria.map((criterion) => [criterion.id, criterion]))
  const source = `judge:${job.id}:`

  function select(name: string) {
    setSelectedName(name)
    if (name !== selected?.name && target?.source?.startsWith(source)) onEvidence(null)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const current = tabs.findIndex((tab) => tab === event.target)
    if (current < 0) return
    const last = tabs.length - 1
    const positions: Partial<Record<string, number>> = {
      ArrowLeft: (current + last) % tabs.length, ArrowRight: (current + 1) % tabs.length, Home: 0, End: last,
    }
    const next = positions[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(judges[next].name)
    tabs[next].focus()
  }

  return <div className="judge-results">
    <div className="judge-tabs" role="tablist" aria-label={t('judgeResults')} onKeyDown={navigate}>
      {judges.map((judge, index) => {
        const status = judge.displayStatus
        const isSelected = judge === selected
        return <button key={judge.name} id={`${id}-tab-${index}`} className="judge-tab" type="button" role="tab"
          aria-selected={isSelected} aria-controls={`${id}-panel-${index}`} tabIndex={isSelected ? 0 : -1}
          onClick={() => select(judge.name)}>
          <strong>{judge.name}</strong><span className={`judge-tab-status judge-${status}`}>{t(status === 'ok' ? 'completed' : status)}</span>
        </button>
      })}
    </div>
    {judges.map((judge, index) => <div key={judge.name} id={`${id}-panel-${index}`} className="judge-tab-panel"
      role="tabpanel" aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={judge !== selected}>
      {judge === selected && <>
        <p className="judge-detail" role="status">
          {judge.grades ? t('completedCriteria', { criteria: t('criteriaCount', { count: judge.grades.length }) }) :
            judge.displayStatus === 'unavailable' || judge.status === 'ok' ? t('judgeGradesUnavailable') : t(judge.status)}
          {judge.seconds != null && ` · ${t('seconds', { value: judge.seconds.toFixed(1) })}`}
          {judge.error_code && ` · ${judge.error_code.replaceAll('_', ' ')}`}
        </p>
        {judge.grades && <ol className="judge-grades">
          {judge.grades.map((grade) => {
            const criterion = criteria.get(grade.criterion_id)
            const style = grade.value === 'na' ? 'na' : typeof grade.value === 'number' ? 'scale'
              : (grade.value === 'yes') !== (criterion?.kind === 'flag') ? 'positive' : 'negative'
            return <li className="criterion" key={grade.criterion_id}>
              <div className="criterion-title judge-criterion-title">
                <h4>{criterion?.label ?? grade.criterion_id}</h4>
                <span className={`grade-pill grade-${style}`}>{gradeLabel(grade.value, criterion, t)}</span>
              </div>
              <p className="criterion-reason">{grade.reason}</p>
              <EvidenceLinks grade={grade} turns={turns} target={target} source={`${source}${judge.name}`} onEvidence={onEvidence} />
            </li>
          })}
        </ol>}
      </>}
    </div>)}
  </div>
}
