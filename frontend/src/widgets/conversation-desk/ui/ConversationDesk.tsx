import { useCallback, useEffect, useRef, useState } from 'react'
import { demoRecordingOffsets, qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, Evaluation, EvaluationJob } from '../../../entities/quality'
import { useRemote } from '../../../shared/lib/useRemote'
import { Icon } from '../../../shared/ui/Icon'
import { ReviewCriterion } from '../../../features/review-criterion'
import { RecordingPlayer } from './RecordingPlayer'
import { formatClock, recordingLink } from './recording'
import { Results } from './Results'
import { RunComparison } from './RunComparison'
import { Transcript } from './Transcript'
import { EvaluationProgress } from './EvaluationProgress'
import type { EvidenceTarget } from './Transcript'
import './conversation-desk.css'

const languages = { RU: 'Russian', KZ: 'Kazakh', EN: 'English' }

export function ConversationDesk({ summary, versions, version, loadingChecklists, view, jobs, completed, reviewed, starting, failure, onSelectVersion, onRun, onCancel, onUpdated, onAnalysis }: {
  summary: ConversationSummary
  versions: Checklist[]
  version?: Checklist
  loadingChecklists: boolean
  view: 'analysis' | 'appeals'
  jobs: EvaluationJob[]
  completed: Evaluation[]
  reviewed: Evaluation[]
  starting: boolean
  failure?: { message: string; versionId: string }
  onSelectVersion: (versionId: string) => void
  onRun: (versionId: string) => void
  onCancel: (id: string) => Promise<void>
  onUpdated: (evaluation: Evaluation) => void
  onAnalysis: () => void
}) {
  const { key } = summary
  const conversation = useRemote(useCallback((signal: AbortSignal) => qualityApi.getConversation(key, signal), [key]))
  const history = useRemote(useCallback((signal: AbortSignal) => qualityApi.listEvaluations(key, signal), [key]))
  const [runId, setRunId] = useState('')
  const [storedTarget, setTarget] = useState<EvidenceTarget | null>(null)
  const target = storedTarget?.origin.isConnected ? storedTarget : null
  const [comparing, setComparing] = useState(false)
  const compareButton = useRef<HTMLButtonElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const selectedVersionRunning = starting || jobs.some((job) =>
    job.checklist_version_id === version?.version_id && (job.status === 'queued' || job.status === 'running'))
  const newestCompletedId = completed[0]?.id
  useEffect(() => {
    if (newestCompletedId) {
      setRunId(newestCompletedId)
      setTarget((previous) => previous?.source?.startsWith('judge:') ? previous : null)
    }
  }, [newestCompletedId])

  const remoteRuns = [...completed, ...(history.data?.items ?? []).filter((item) => !completed.some((run) => run.id === item.id))]
  const reviewsById = new Map(reviewed.map((item) => [item.id, item]))
  const runs = remoteRuns.map((item) => reviewsById.get(item.id) ?? item)
  const evaluation = runs.find((item) => item.id === runId) ?? runs[0]
  const isCall = summary.channel === 'voice call'
  const recording = isCall ? recordingLink(conversation.data?.audio_url ?? null) : null

  const runHistory = runs.length > 1 && <label className="run-history">
    <span className="sr-only">Evaluation history</span>
    <select value={evaluation?.id ?? ''} onChange={(event) => { setRunId(event.target.value); setTarget(null) }}>
      {runs.map((run, index) => <option value={run.id} key={run.id}>{index === 0 ? 'Latest run' : `Run ${runs.length - index}`} · {run.checklist.version_id}</option>)}
    </select>
  </label>

  function updateEvaluation(result: Evaluation) {
    setTarget(null)
    onUpdated(result)
  }

  function toggleComparison() {
    setComparing(!comparing)
    setTarget(null)
    requestAnimationFrame(() => {
      if (comparing) compareButton.current?.focus()
      else document.getElementById('run-comparison')?.focus()
    })
  }

  return <section className="desk" aria-labelledby="conversation-heading">
    <header className="desk-heading">
      <div>
        <h1 id="conversation-heading">{view === 'appeals' ? 'Appeals' : 'Conversation review'}</h1>
        <div className="conversation-tags">
          <span className="conversation-ref"><Icon name={isCall ? 'phone' : 'chat'} size={15} /> {isCall ? 'Call' : 'Chat'} <strong>{summary.conversation_id}</strong></span>
          <span>{languages[summary.language] ?? summary.language}</span>
          {recording && duration !== null && <span><Icon name="clock" size={14} /> {formatClock(duration)}</span>}
          <span>Group {summary.group_id}</span>
        </div>
      </div>
      {view === 'analysis' && <div className="run-controls">
        <label className="version-control"><span className="field-label">Checklist version</span>
          <select value={version?.version_id ?? ''} onChange={(event) => onSelectVersion(event.target.value)} disabled={!version}>
            {!version && <option value="">{loadingChecklists ? 'Loading versions…' : 'No versions available'}</option>}
            {versions.map((checklist) => <option value={checklist.version_id} key={checklist.version_id}>{checklist.version_id} · {checklist.name}</option>)}
          </select>
        </label>
        <button type="button" className="button button-primary" disabled={!version || !conversation.data || selectedVersionRunning} onClick={() => { if (version) onRun(version.version_id) }}>
          <Icon name="activity" size={17} /> {selectedVersionRunning ? 'Evaluation in progress' : 'Run evaluation'}
        </button>
      </div>}
    </header>
    {conversation.error && <div className="desk-message"><p role="alert">{conversation.error}</p><button className="button button-outline" onClick={conversation.refresh}>Retry transcript</button></div>}
    {!conversation.data && conversation.loading && <p className="desk-message" role="status">Loading transcript…</p>}
    <EvaluationProgress jobs={jobs} versions={versions} runs={runs} evaluation={evaluation} starting={starting}
      evidence={view === 'analysis' ? { turns: conversation.data?.turns, target, onEvidence: setTarget } : undefined}
      failure={failure} onCancel={onCancel} onRetry={onRun} />
    {conversation.data && view === 'appeals' && <section className="pane appeals-pane" aria-labelledby="appeals-heading">
      <header className="pane-heading"><div><h2 id="appeals-heading">Appeals for this conversation</h2>{evaluation && <p className="form-note">Checklist {evaluation.checklist.version_id}</p>}</div>{runHistory}</header>
      {history.error && <div className="history-error"><p className="inline-error" role="alert">{history.error}</p><button className="button button-outline" onClick={history.refresh}>Retry history</button></div>}
      {history.loading && <p className="empty-detail" role="status">Loading evaluation history…</p>}
      {evaluation?.appeals.length ? <ul className="appeal-list">
        {evaluation.appeals.map((appeal) => {
          const criterion = evaluation.checklist.criteria.find(({ id }) => id === appeal.criterion_id)
          const original = evaluation.original.items.find(({ criterion_id }) => criterion_id === appeal.criterion_id)
          return criterion && original && <li className="criterion" key={`${evaluation.id}-${appeal.criterion_id}`}>
            <h3>{criterion.label}</h3>
            <ReviewCriterion evaluationId={evaluation.id} criterion={criterion} original={original} turns={conversation.data!.turns}
              appeal={appeal} vote={evaluation.panel?.votes.find((vote) => vote.criterion_id === criterion.id)} disabled={false} onUpdated={updateEvaluation} />
          </li>
        })}
      </ul> : !history.error && !history.loading && <div className="empty-detail">
        <h3>No appeals on this evaluation</h3><p>Open the conversation review to appeal a grade on a specific criterion.</p>
        <button className="button button-outline" type="button" onClick={onAnalysis}>Open review</button>
      </div>}
      {!!evaluation?.appeals.length && <div className="appeals-footer"><button className="button button-outline" type="button" onClick={onAnalysis}>View scores and evidence</button></div>}
    </section>}
    {conversation.data && view === 'analysis' && <>
      <nav className="mobile-jump" aria-label="Conversation sections">
        <a href="#transcript-heading"><Icon name="file" size={17} /> Transcript</a>
        <a href="#results-heading"><Icon name="activity" size={17} /> Quality score</a>
      </nav>
      <div className="desk-columns">
        <div className="conversation-source">
          {recording && <RecordingPlayer key={recording} url={recording} turns={conversation.data.turns} duration={duration}
            offsets={demoRecordingOffsets(conversation.data)} target={target} onDuration={setDuration} />}
          {isCall && !recording && <div className="recording-unavailable pane"><Icon name="phone" size={18} /> Call recording unavailable. You can still review the transcript.</div>}
          <Transcript conversation={conversation.data} target={target} />
        </div>
        <section className="results pane" aria-labelledby="results-heading">
          <header className="pane-heading">
            <h2 id="results-heading" tabIndex={-1}>Quality score</h2>
            {runHistory}
          </header>
          {history.error && <div className="history-error"><p className="inline-error" role="alert">{history.error}</p><button className="button button-outline" onClick={history.refresh}>Retry history</button></div>}
          {evaluation && version && evaluation.checklist.version_id !== version.version_id && <p className="version-notice">
            This saved result uses <strong>{evaluation.checklist.version_id}</strong>. Run an evaluation to apply the selected <strong>{version.version_id}</strong> checklist.
          </p>}
          {evaluation ? <Results key={evaluation.id} evaluation={evaluation} conversation={conversation.data} target={target}
            onEvidence={setTarget} onUpdated={updateEvaluation}
            comparison={runs.length > 1 && <button ref={compareButton} className="button button-outline" type="button" aria-expanded={comparing} aria-controls={comparing ? 'run-comparison' : undefined}
              onClick={toggleComparison}>
              <Icon name="layers" size={16} /> {comparing ? 'Close comparison' : 'Compare versions'}
            </button>} />
            : history.loading ? <p className="empty-detail" role="status">Loading evaluation history…</p>
            : !history.error && <div className="empty-detail"><span className="empty-icon"><Icon name="activity" size={23} /></span><h3>No evaluations yet</h3><p>Select a checklist version and run an evaluation to see grades and evidence for this conversation.</p></div>}
        </section>
      </div>
      {comparing && evaluation && <div id="run-comparison" className="pane comparison-panel" tabIndex={-1} aria-label="Checklist version comparison">
        <div className="comparison-actions"><button className="button button-outline" type="button" onClick={toggleComparison}><Icon name="close" size={16} /> Close comparison</button></div>
        <RunComparison key={evaluation.id} runs={runs} current={evaluation} conversation={conversation.data}
          target={target} onEvidence={setTarget} onSelectionChange={() => setTarget(null)} />
      </div>}
    </>}
  </section>
}
