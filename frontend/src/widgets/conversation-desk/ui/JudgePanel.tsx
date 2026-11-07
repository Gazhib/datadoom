import { isSplitVote } from '../../../entities/quality'
import type { Panel } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import './judge-panel.css'

export function JudgePanel({ panel, splitOnly, onSplitOnly }: {
  panel: Panel
  splitOnly: boolean
  onSplitOnly: (value: boolean) => void
}) {
  const splits = panel.votes.filter(isSplitVote).length
  return <section className="judge-panel" aria-label="Judge panel">
    <header className="judge-panel-heading">
      <h3><Icon name="scales" size={18} /> Judge panel</h3>
      <span className="panel-agreement">{Math.round(panel.agreement * 100)}% agreement</span>
    </header>
    <p className="panel-summary">{splits} split {splits === 1 ? 'criterion' : 'criteria'} · Quorum {panel.quorum}</p>
    <ul className="panel-judges">
      {panel.judges.map((judge) => <li key={judge.name}>
        <div className="panel-judge-name"><strong>{judge.name}</strong><span className={`panel-status panel-status-${judge.status}`}>{judge.status}</span>
          {judge.fallback && <span className="fallback-badge">Fallback</span>}
          {judge.seconds !== null && <span className="judge-seconds">{judge.seconds.toFixed(1)} s</span>}
        </div>
        <span className="panel-model">{judge.provider} / {judge.model}</span>
        <span className="panel-host">{judge.host}</span>
        {judge.error_code && <span className="inline-error">{judge.error_code}</span>}
      </li>)}
    </ul>
    <label className="panel-filter"><input type="checkbox" checked={splitOnly} onChange={(event) => onSplitOnly(event.target.checked)} /> Show only split criteria</label>
  </section>
}
