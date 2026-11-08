import { useI18n } from '../../../shared/i18n/useI18n'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { gradeLabel, gradeTone } from '../../../entities/quality'
import type { Checklist, Grade, Turn } from '../../../entities/quality'
import type { JudgeVerdict } from '../model/judgeVerdicts'
import { EvidenceLinks } from './EvidenceLinks'
import type { EvidenceTarget } from './Transcript'

function JudgeGrades({ judge, checklist, turns, target, source, onEvidence }: {
  judge: JudgeVerdict
  checklist?: Checklist
  turns: Map<string, Turn>
  target: EvidenceTarget | null
  source: string
  onEvidence: (target: EvidenceTarget | null) => void
}) {
  const { t } = useI18n()
  const criteria = new Map(checklist?.criteria.map((criterion) => [criterion.id, criterion]))
  const ids = checklist?.criteria.map(({ id }) => id) ?? [...(judge.grades?.keys() ?? judge.ballots.keys())]
  const rows = ids.flatMap((id) => {
    const grade: Grade | undefined = judge.grades?.get(id)
    const value = grade?.value ?? judge.ballots.get(id)
    return value === undefined ? [] : [{ id, grade, value }]
  })
  const votesOnly = !judge.grades && rows.length > 0
  return <>
    <p className="judge-detail" role="status">
      {judge.grades ? t('completedCriteria', { criteria: t('criteriaCount', { count: judge.grades.size }) })
        : votesOnly ? t('judgeVotesOnly')
        : judge.status === 'unavailable' || judge.status === 'ok' ? t('judgeGradesUnavailable') : t(judge.status)}
      {judge.model && ` · ${judge.model}`}
      {judge.seconds != null && ` · ${t('seconds', { value: judge.seconds.toFixed(1) })}`}
      {judge.errorCode && ` · ${judge.errorCode.replaceAll('_', ' ')}`}
    </p>
    {rows.length > 0 && <ol className="judge-grades">
      {rows.map(({ id, grade, value }) => {
        const criterion = criteria.get(id)
        return <li className="criterion" key={id}>
          <div className="criterion-title judge-criterion-title">
            <h4>{criterion?.label ?? id}</h4>
            <span className={`grade-pill grade-${gradeTone(value, criterion)}`}>{gradeLabel(value, criterion, t)}</span>
          </div>
          {grade && <p className="criterion-reason">{grade.reason}</p>}
          {grade && <EvidenceLinks grade={grade} turns={turns} target={target} source={`${source}${judge.name}`} onEvidence={onEvidence} />}
        </li>
      })}
    </ol>}
  </>
}

export function JudgeResults({ judges, checklist, turns, target, source, onEvidence }: {
  judges: JudgeVerdict[]
  checklist?: Checklist
  turns: Map<string, Turn>
  target: EvidenceTarget | null
  // Evidence targets from this view start with this prefix, so switching judges can clear them.
  source: string
  onEvidence: (target: EvidenceTarget | null) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [selectedName, setSelectedName] = useState('')
  const selected = judges.find((judge) => judge.name === selectedName) ?? judges[0]

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
        const isSelected = judge === selected
        return <button key={judge.name} id={`${id}-tab-${index}`} className="judge-tab" type="button" role="tab"
          aria-selected={isSelected} aria-controls={`${id}-panel-${index}`} tabIndex={isSelected ? 0 : -1}
          onClick={() => select(judge.name)}>
          <strong>{judge.name}</strong><span className={`judge-tab-status judge-${judge.status}`}>{t(judge.status === 'ok' ? 'completed' : judge.status)}</span>
        </button>
      })}
    </div>
    {judges.map((judge, index) => <div key={judge.name} id={`${id}-panel-${index}`} className="judge-tab-panel"
      role="tabpanel" aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={judge !== selected}>
      {judge === selected && <JudgeGrades judge={judge} checklist={checklist} turns={turns} target={target} source={source} onEvidence={onEvidence} />}
    </div>)}
  </div>
}
