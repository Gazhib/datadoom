import { useI18n } from '../../../shared/i18n/useI18n'
import { isSplitVote } from '../../../entities/quality'
import type { Panel } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import './judge-panel.css'

export function JudgePanel({ panel, splitOnly, onSplitOnly }: {
  panel: Panel
  splitOnly: boolean
  onSplitOnly: (value: boolean) => void
}) {
  const { t } = useI18n()
  const splits = panel.votes.filter(isSplitVote).length
  return <section className="judge-panel" aria-label={t('judgePanel')}>
    <header className="judge-panel-heading">
      <h3><Icon name="scales" size={18} /> {t('judgePanel')}</h3>
      <span className="panel-agreement">{t('judgeAgreement', { percent: Math.round(panel.agreement * 100) })}</span>
    </header>
    <p className="panel-summary">{t('splitCriteriaCount', { count: splits })} · {t('quorum', { count: panel.quorum })}</p>
    <ul className="panel-judges">
      {panel.judges.map((judge) => <li key={judge.name}>
        <div className="panel-judge-name"><strong>{judge.name}</strong><span className={`panel-status panel-status-${judge.status}`}>{t(judge.status === 'ok' ? 'completed' : judge.status)}</span>
          {judge.fallback && <span className="fallback-badge">{t('fallback')}</span>}
          {judge.seconds !== null && <span className="judge-seconds">{t('seconds', { value: judge.seconds.toFixed(1) })}</span>}
        </div>
        <span className="panel-model">{judge.provider} / {judge.model}</span>
        <span className="panel-host">{judge.host}</span>
        {judge.error_code && <span className="inline-error">{judge.error_code}</span>}
      </li>)}
    </ul>
    <label className="panel-filter"><input type="checkbox" checked={splitOnly} onChange={(event) => onSplitOnly(event.target.checked)} /> {t('showSplitOnly')}</label>
  </section>
}
