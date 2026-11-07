import { useCallback, useRef, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, Evaluation } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import { errorMessage, useRemote } from '../model/useRemote'
import { Results } from './Results'
import { Transcript } from './Transcript'
import type { EvidenceTarget } from './Transcript'

export function ConversationDesk({ summary, checklists, loadingChecklists, onRunningChange }: {
  summary: ConversationSummary
  checklists: Checklist[]
  loadingChecklists: boolean
  onRunningChange: (running: boolean) => void
}) {
  const { key } = summary
  const conversation = useRemote(useCallback((signal: AbortSignal) => qualityApi.getConversation(key, signal), [key]))
  const history = useRemote(useCallback((signal: AbortSignal) => qualityApi.listEvaluations(key, signal), [key]))
  const [versionId, setVersionId] = useState('')
  const [runId, setRunId] = useState('')
  const [created, setCreated] = useState<Evaluation[]>([])
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const busy = useRef(false)

  const version = checklists.find((item) => item.version_id === versionId) ?? checklists[0]
  const runs = [...created, ...(history.data?.items ?? []).filter((item) => !created.some((run) => run.id === item.id))]
  const evaluation = runs.find((item) => item.id === runId) ?? runs[0]

  async function runEvaluation() {
    if (!version || busy.current) return
    busy.current = true
    setRunning(true)
    onRunningChange(true)
    setRunError(null)
    try {
      const result = await qualityApi.evaluate(key, version.version_id)
      setCreated((previous) => [result, ...previous])
      setRunId(result.id)
      setTarget(null)
    } catch (failure) {
      setRunError(errorMessage(failure))
    } finally {
      busy.current = false
      setRunning(false)
      onRunningChange(false)
    }
  }

  return <section className="desk" aria-labelledby="conversation-heading">
    <header className="desk-heading">
      <div className="conversation-heading">
        <span className="conversation-icon"><Icon name={summary.channel === 'voice call' ? 'phone' : 'chat'} size={24} /></span>
        <div className="conversation-heading-copy">
          <h2 id="conversation-heading">{summary.conversation_id}</h2>
          <div className="conversation-tags"><span className="conversation-channel">{summary.channel}</span><span>{summary.group_id}</span><span>{summary.language}</span></div>
        </div>
      </div>
      <div className="run-controls">
        <label className="version-control"><span className="field-label">Checklist version</span>
          <select value={version?.version_id ?? ''} onChange={(event) => setVersionId(event.target.value)} disabled={!version || running}>
            {!version && <option value="">{loadingChecklists ? 'Loading versions…' : 'No versions available'}</option>}
            {checklists.map((checklist) => <option value={checklist.version_id} key={checklist.version_id}>{checklist.version_id} · {checklist.name}</option>)}
          </select>
        </label>
        <button type="button" className="button button-run" disabled={!version || !conversation.data || running} onClick={runEvaluation}>
          <Icon name="play" size={16} /> {running ? 'Evaluating…' : 'Run evaluation'}
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
          {evaluation ? <Results evaluation={evaluation} conversation={conversation.data} target={target} onEvidence={setTarget} />
            : history.loading ? <p className="empty-detail" role="status">Loading evaluation history…</p>
            : !history.error && !running && <div className="empty-detail"><span className="empty-icon"><Icon name="activity" size={23} /></span><h3>No evaluations yet</h3><p>Select a checklist version and run an evaluation to see grades and evidence for this conversation.</p></div>}
        </section>
      </div>
    </>}
  </section>
}
