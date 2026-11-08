import { useI18n } from '../../../shared/i18n/useI18n'
import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Checklist, Turn } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import type { JudgeVerdict } from '../model/judgeVerdicts'
import { JudgeResults } from './JudgeResults'
import type { EvidenceTarget } from './Transcript'

type Tab = 'verdict' | 'judges'
export type JudgeView = { judges: JudgeVerdict[]; checklist: Checklist; turns: Map<string, Turn>; source: string }

export function VerdictPane({ runHistory, progress, judgeView, target, onEvidence, children }: {
  runHistory: ReactNode
  // Live run status, shown above the tabs so it never pushes the transcript down.
  progress: ReactNode
  // Absent until an evaluation exists; the pane then shows only its children.
  judgeView: JudgeView | null
  target: EvidenceTarget | null
  onEvidence: (target: EvidenceTarget | null) => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const [tab, setTab] = useState<Tab>('verdict')
  const active: Tab = judgeView ? tab : 'verdict'
  const tabs: { key: Tab; label: string; icon: 'activity' | 'scales' }[] = [
    { key: 'verdict', label: t('verdictTab'), icon: 'activity' },
    { key: 'judges', label: t('byJudgeTab'), icon: 'scales' },
  ]

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: Tab = active === 'verdict' ? 'judges' : 'verdict'
    setTab(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }

  return <section className="results pane verdict-pane" aria-labelledby="results-heading">
    <header className="pane-heading verdict-heading">
      <h2 id="results-heading" tabIndex={-1}>{t('qualityScore')}</h2>
      {runHistory}
      {judgeView && <div className="pane-tabs" role="tablist" aria-label={t('verdictViews')} onKeyDown={navigate}>
        {tabs.map(({ key, label, icon }) => <button key={key} type="button" role="tab" data-tab={key} id={`${id}-${key}`}
          aria-selected={active === key} aria-controls={`${id}-panel`} tabIndex={active === key ? 0 : -1} onClick={() => setTab(key)}>
          <Icon name={icon} size={15} /> {label}{key === 'judges' && <span className="pane-tab-count">{judgeView.judges.length}</span>}
        </button>)}
      </div>}
    </header>
    <div className="verdict-body">
      {progress && <div className="verdict-progress">{progress}</div>}
      <div id={`${id}-panel`} role={judgeView ? 'tabpanel' : undefined} aria-labelledby={judgeView ? `${id}-${active}` : undefined}>
        {active === 'verdict' ? children : judgeView && <div className="verdict-judges">
          <JudgeResults judges={judgeView.judges} checklist={judgeView.checklist} turns={judgeView.turns}
            source={judgeView.source} target={target} onEvidence={onEvidence} />
        </div>}
      </div>
    </div>
  </section>
}
