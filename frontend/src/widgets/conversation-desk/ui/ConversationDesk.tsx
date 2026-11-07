import { useCallback, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, Evaluation } from '../../../entities/quality'
import { useMutation } from '../../../shared/lib/useMutation'
import { useRemote } from '../../../shared/lib/useRemote'
import { Icon } from '../../../shared/ui/Icon'
import { Results } from './Results'
import { Transcript } from './Transcript'
import type { EvidenceTarget } from './Transcript'
import './conversation-desk.css'

export function ConversationDesk({ summary, versions, version, loadingChecklists, onSelectVersion, onRunningChange }: {
  summary: ConversationSummary
  versions: Checklist[]
  version?: Checklist
  loadingChecklists: boolean
  onSelectVersion: (versionId: string) => void
  onRunningChange: (running: boolean) => void
}) {
  const { key } = summary
  const conversation = useRemote(useCallback((signal: AbortSignal) => qualityApi.getConversation(key, signal), [key]))
  const history = useRemote(useCallback((signal: AbortSignal) => qualityApi.listEvaluations(key, signal), [key]))
  const [runId, setRunId] = useState('')
  const [updates, setUpdates] = useState<Evaluation[]>([])
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const { run, pending: running, error: runError } = useMutation()

  const remoteRuns = history.data?.items ?? []
  const updatesById = new Map(updates.map((item) => [item.id, item]))
  const runs = [
    ...updates.filter((item) => !remoteRuns.some((remote) => remote.id === item.id)),
    ...remoteRuns.map((item) => updatesById.get(item.id) ?? item),
  ]
  const evaluation = runs.find((item) => item.id === runId) ?? runs[0]

  function updateEvaluation(result: Evaluation) {
    setUpdates((previous) => previous.some((item) => item.id === result.id)
      ? previous.map((item) => item.id === result.id ? result : item)
      : [result, ...previous])
    setTarget(null)
  }

  function runEvaluation() {
    if (!version) return
    void run(async () => {
      onRunningChange(true)
      try {
        const result = await qualityApi.evaluate(key, version.version_id)
        updateEvaluation(result)
        setRunId(result.id)
      } finally {
        onRunningChange(false)
      }
    })
  }

  return <section className="desk" aria-labelledby="conversation-heading">
    <header className="desk-heading">
      <div className="conversation-heading">
        <span className="conversation-icon"><Icon name={summary.channel === 'voice call' ? 'phone' : 'chat'} size={24} /></span>
        <div className="conversation-heading-copy">
          <p className="conversation-eyebrow">CONVERSATION DETAILS</p><h2 id="conversation-heading">{summary.conversation_id}</h2>
          <div className="conversation-tags"><span className="conversation-channel">{summary.channel}</span><span>{summary.group_id}</span><span>{summary.language}</span></div>
        </div>
      </div>
      <div className="run-controls">
        <label className="version-control"><span className="field-label">Checklist version</span>
          <select value={version?.version_id ?? ''} onChange={(event) => onSelectVersion(event.target.value)} disabled={!version || running}>
            {!version && <option value="">{loadingChecklists ? 'Loading versions…' : 'No versions available'}</option>}
            {versions.map((checklist) => <option value={checklist.version_id} key={checklist.version_id}>{checklist.version_id} · {checklist.name}</option>)}
          </select>
        </label>
        <button type="button" className="button button-primary" disabled={!version || !conversation.data || running} onClick={runEvaluation}>
          <Icon name="activity" size={16} /> {running ? 'Evaluating…' : 'Run evaluation'}<Icon name="arrowUpRight" size={14} />
        </button>
      </div>
    </header>
    {conversation.error && <div className="desk-message"><p role="alert">{conversation.error}</p><button className="button button-outline" onClick={conversation.refresh}>Retry transcript</button></div>}
    {!conversation.data && conversation.loading && <p className="desk-message" role="status">Loading transcript…</p>}
    {conversation.data && <>
      <nav className="mobile-jump" aria-label="Conversation sections">
        <a href="#transcript-heading"><Icon name="file" size={17} /> Transcript</a>
        <a href="#results-heading"><Icon name="activity" size={17} /> Evaluation</a>
      </nav>
      <div className="desk-columns">
        <Transcript conversation={conversation.data} target={target} />
        <section className="results pane" aria-labelledby="results-heading">
          <header className="pane-heading">
            <div className="pane-title"><span className="panel-icon"><Icon name="activity" size={19} /></span><h2 id="results-heading" tabIndex={-1}>Evaluation</h2></div>
            {runs.length > 1 && <label className="run-history">
              <span className="sr-only">Evaluation history</span>
              <select value={evaluation?.id ?? ''} onChange={(event) => { setRunId(event.target.value); setTarget(null) }}>
                {runs.map((run, index) => <option value={run.id} key={run.id}>{index === 0 ? 'Latest run' : `Run ${runs.length - index}`} · {run.checklist.version_id}</option>)}
              </select>
            </label>}
          </header>
          {running && <p className="run-notice" role="status"><span className="spinner" /> Evaluating this conversation…</p>}
          {runError && <p className="inline-error" role="alert">{runError}</p>}
          {history.error && <div className="history-error"><p className="inline-error" role="alert">{history.error}</p><button className="button button-outline" onClick={history.refresh}>Retry history</button></div>}
          {evaluation ? <Results key={evaluation.id} evaluation={evaluation} conversation={conversation.data} target={target}
            running={running} onEvidence={setTarget} onUpdated={updateEvaluation} />
            : history.loading ? <p className="empty-detail" role="status">Loading evaluation history…</p>
            : !history.error && !running && <div className="empty-detail"><span className="empty-icon"><Icon name="activity" size={23} /></span><h3>No evaluations yet</h3><p>Select a checklist version and run an evaluation to see grades and evidence for this conversation.</p></div>}
        </section>
      </div>
    </>}
  </section>
}
