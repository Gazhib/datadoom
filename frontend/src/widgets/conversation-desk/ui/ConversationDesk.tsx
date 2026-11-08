import { useI18n } from '../../../shared/i18n/useI18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { demoRecordingOffsets, qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, Evaluation, EvaluationJob } from '../../../entities/quality'
import { useRemote } from '../../../shared/lib/useRemote'
import { Icon } from '../../../shared/ui/Icon'
import { ReviewCriterion } from '../../../features/review-criterion'
import { RecordingPlayer } from './RecordingPlayer'
import { recordingLink } from './recording'
import { Results } from './Results'
import { RunComparison } from './RunComparison'
import { Transcript } from './Transcript'
import { EvaluationProgress } from './EvaluationProgress'
import { TurnVerdicts } from './TurnVerdicts'
import { VerdictPane } from './VerdictPane'
import { evaluationJudges, turnMarks, turnRows } from '../model/judgeVerdicts'
import type { EvidenceTarget } from './Transcript'
import './conversation-desk.css'

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
  failure?: { error: Error; versionId: string }
  onSelectVersion: (versionId: string) => void
  onRun: (versionId: string) => void
  onCancel: (id: string) => Promise<void>
  onUpdated: (evaluation: Evaluation) => void
  onAnalysis: () => void
}) {
  const { t } = useI18n()
  const { key } = summary
  const conversation = useRemote(useCallback((signal: AbortSignal) => qualityApi.getConversation(key, signal), [key]))
  const history = useRemote(useCallback((signal: AbortSignal) => qualityApi.listEvaluations(key, signal), [key]))
  const [runId, setRunId] = useState('')
  const [storedTarget, setTarget] = useState<EvidenceTarget | null>(null)
  const target = storedTarget?.origin.isConnected ? storedTarget : null
  const [comparing, setComparing] = useState(false)
  const compareButton = useRef<HTMLButtonElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [openTurn, setOpenTurn] = useState<string | null>(null)
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
  const turns = conversation.data?.turns ?? []
  const judges = evaluation ? evaluationJudges(evaluation, jobs) : []
  const marks = evaluation && new Map(turns.map((turn) => [turn.id, turnMarks(turnRows(turn.id, evaluation, judges), judges)]))
  const judgeView = evaluation && conversation.data
    ? { judges, checklist: evaluation.checklist, turns: new Map(turns.map((turn) => [turn.id, turn])), source: `judge:${evaluation.id}:` }
    : null
  const inColumns = view === 'analysis' && !!conversation.data
  const progress = <EvaluationProgress jobs={jobs} versions={versions} runs={runs} starting={starting}
    evidence={view === 'analysis' ? { turns: conversation.data?.turns, target, onEvidence: setTarget } : undefined}
    failure={failure} onCancel={onCancel} onRetry={onRun} />
  const recording = isCall ? recordingLink(conversation.data?.audio_url ?? null) : null

  const runHistory = runs.length > 1 && <label className="run-history">
    <span className="sr-only">{t('evaluationHistory')}</span>
    <select value={evaluation?.id ?? ''} onChange={(event) => { setRunId(event.target.value); setTarget(null) }}>
      {runs.map((run, index) => <option value={run.id} key={run.id}>{index === 0 ? t('latestRun') : t('runNumber', { id: runs.length - index })} · {run.checklist.version_id}</option>)}
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
      <h1 id="conversation-heading">{t(view === 'appeals' ? 'appeals' : 'conversationReview')}</h1>
      {view === 'analysis' && <div className="run-controls">
        <label className="version-control"><span className="field-label">{t('checklistVersion')}</span>
          <select value={version?.version_id ?? ''} onChange={(event) => onSelectVersion(event.target.value)} disabled={!version}>
            {!version && <option value="">{loadingChecklists ? t('loadingVersions') : t('noVersions')}</option>}
            {versions.map((checklist) => <option value={checklist.version_id} key={checklist.version_id}>{checklist.version_id} · {checklist.name}</option>)}
          </select>
        </label>
        <button type="button" className="button button-primary" disabled={!version || !conversation.data || selectedVersionRunning} onClick={() => { if (version) onRun(version.version_id) }}>
          <Icon name="activity" size={17} /> {selectedVersionRunning ? t('evaluationInProgress') : t('runEvaluation')}
        </button>
      </div>}
    </header>
    {conversation.error && <div className="desk-message"><p role="alert">{conversation.error}</p><button className="button button-outline" onClick={conversation.refresh}>{t('retryTranscript')}</button></div>}
    {!conversation.data && conversation.loading && <p className="desk-message" role="status">{t('loadingTranscript')}</p>}
    {!inColumns && progress}
    {conversation.data && view === 'appeals' && <section className="pane appeals-pane" aria-labelledby="appeals-heading">
      <header className="pane-heading"><div><h2 id="appeals-heading">{t('conversationAppeals')}</h2>{evaluation && <p className="form-note">{t('checklistReference', { version: evaluation.checklist.version_id })}</p>}</div>{runHistory}</header>
      {history.error && <div className="history-error"><p className="inline-error" role="alert">{history.error}</p><button className="button button-outline" onClick={history.refresh}>{t('retryHistory')}</button></div>}
      {history.loading && <p className="empty-detail" role="status">{t('loadingHistory')}</p>}
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
        <h3>{t('noAppeals')}</h3><p>{t('howToAppeal')}</p>
        <button className="button button-outline" type="button" onClick={onAnalysis}>{t('openReview')}</button>
      </div>}
      {!!evaluation?.appeals.length && <div className="appeals-footer"><button className="button button-outline" type="button" onClick={onAnalysis}>{t('viewScoresEvidence')}</button></div>}
    </section>}
    {conversation.data && view === 'analysis' && <>
      <nav className="mobile-jump" aria-label={t('conversationSections')}>
        <a href="#transcript-heading"><Icon name="file" size={17} /> {t('transcript')}</a>
        <a href="#results-heading"><Icon name="activity" size={17} /> {t('qualityScore')}</a>
      </nav>
      <div className="desk-columns">
        <div className="conversation-source">
          {recording && <RecordingPlayer key={recording} url={recording} turns={conversation.data.turns} duration={duration}
            offsets={demoRecordingOffsets(conversation.data)} target={target} onDuration={setDuration} />}
          {isCall && !recording && <div className="recording-unavailable pane"><Icon name="phone" size={18} /> {t('callRecordingUnavailable')}</div>}
          <Transcript conversation={conversation.data} target={target} marks={marks || undefined} activeId={openTurn} onOpen={setOpenTurn} />
        </div>
        <VerdictPane runHistory={runHistory} progress={progress} judgeView={judgeView} target={target} onEvidence={setTarget}>
          {history.error && <div className="history-error"><p className="inline-error" role="alert">{history.error}</p><button className="button button-outline" onClick={history.refresh}>{t('retryHistory')}</button></div>}
          {evaluation && version && evaluation.checklist.version_id !== version.version_id && <p className="version-notice">
            {t('savedVersionNotice', { saved: evaluation.checklist.version_id, selected: version.version_id })}
          </p>}
          {evaluation ? <Results key={evaluation.id} evaluation={evaluation} conversation={conversation.data} target={target}
            onEvidence={setTarget} onUpdated={updateEvaluation}
            comparison={runs.length > 1 && <button ref={compareButton} className="button button-outline" type="button" aria-expanded={comparing} aria-controls={comparing ? 'run-comparison' : undefined}
              onClick={toggleComparison}>
              <Icon name="layers" size={16} /> {comparing ? t('closeComparison') : t('compareVersions')}
            </button>} />
            : history.loading ? <p className="empty-detail" role="status">{t('loadingHistory')}</p>
            : !history.error && !jobs.some((job) => job.status === 'queued' || job.status === 'running') && <div className="empty-detail"><span className="empty-icon"><Icon name="activity" size={23} /></span><h3>{t('noEvaluations')}</h3><p>{t('noEvaluationsHelp')}</p></div>}
        </VerdictPane>
      </div>
      {openTurn && evaluation && <TurnVerdicts conversation={conversation.data} evaluation={evaluation} judges={judges}
        turnId={openTurn} onNavigate={setOpenTurn} onClose={() => setOpenTurn(null)} />}
      {comparing && evaluation && <div id="run-comparison" className="pane comparison-panel" tabIndex={-1} aria-label={t('checklistComparison')}>
        <div className="comparison-actions"><button className="button button-outline" type="button" onClick={toggleComparison}><Icon name="close" size={16} /> {t('closeComparison')}</button></div>
        <RunComparison key={evaluation.id} runs={runs} current={evaluation} conversation={conversation.data}
          target={target} onEvidence={setTarget} onSelectionChange={() => setTarget(null)} />
      </div>}
    </>}
  </section>
}
