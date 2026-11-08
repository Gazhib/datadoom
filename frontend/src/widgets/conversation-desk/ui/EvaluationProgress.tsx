import { useI18n } from '../../../shared/i18n/useI18n'
import { useEffect, useState } from 'react'
import type { Checklist, Evaluation, EvaluationJob, Turn } from '../../../entities/quality'
import { errorMessage } from '../../../shared/lib/errorMessage'
import { useMutation } from '../../../shared/lib/useMutation'
import { Icon } from '../../../shared/ui/Icon'
import { jobJudges } from '../model/judgeVerdicts'
import { JudgeResults } from './JudgeResults'
import type { EvidenceTarget } from './Transcript'
import './evaluation-progress.css'

const active = (job: EvaluationJob) => job.status === 'queued' || job.status === 'running'
const jobStates = { queued: 'queue', running: 'running', succeeded: 'completed', failed: 'failed', cancelled: 'cancelled' } as const
type Evidence = { turns?: Turn[]; target: EvidenceTarget | null; onEvidence: (target: EvidenceTarget | null) => void }

function elapsed(startedAt: string | null, now: number) {
  const seconds = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function JobProgress({ job, now, checklist, evidence, onCancel, onRetry }: {
  job: EvaluationJob
  now: number
  checklist?: Checklist
  evidence?: Evidence
  onCancel: (id: string) => Promise<void>
  onRetry: (versionId: string) => void
}) {
  const { t } = useI18n()
  const { run, pending, error } = useMutation()
  const queued = job.status === 'queued'
  return <section className={`evaluation-progress progress-${job.status}`} aria-label={t('evaluationStatus', { version: job.checklist_version_id, status: t(jobStates[job.status]) })}>
    <div className="progress-heading">
      <div className="progress-title">
        {active(job) ? <span className="spinner" aria-hidden="true" /> : <Icon name={job.status === 'succeeded' ? 'check' : job.status === 'failed' ? 'flag' : 'minus'} size={17} />}
        <strong role="status">{queued ? (job.queue_position && job.queue_position > 1
          ? t('queuedAhead', { count: job.queue_position - 1 }) : t('nextToRun'))
          : job.status === 'running' ? <>{t('running')} · <span aria-live="off">{elapsed(job.started_at, now)}</span></>
          : job.status === 'succeeded' ? t('evaluationCompleted') : job.status === 'failed' ? t('evaluationFailed') : t('evaluationCancelled')}</strong>
        <span className="progress-version">{job.checklist_version_id}</span>
      </div>
      {queued && <button className="button button-outline" type="button" disabled={pending}
        onClick={() => { void run(() => onCancel(job.id)) }}>{pending ? t('cancelling') : t('cancelQueuedRun')}</button>}
      {job.status === 'failed' && <button className="button button-outline" type="button" onClick={() => onRetry(job.checklist_version_id)}>{t('retryEvaluation')}</button>}
    </div>
    {job.error && <p className="inline-error" role="alert">
      {job.error.code === 'fixture_failure' ? t('demoEvaluationFailure') : job.error.message}
    </p>}
    {evidence && !!job.progress?.judges.length && <JudgeResults judges={jobJudges(job)} checklist={checklist}
      turns={new Map(evidence.turns?.map((turn) => [turn.id, turn]))} source={`judge:${job.id}:`}
      target={evidence.target} onEvidence={evidence.onEvidence} />}
    {job.id.startsWith('sync-') && <p className="form-note">{t('keepTabOpen')}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>
}

export function EvaluationProgress({ jobs, versions, runs, evidence, starting, failure, onCancel, onRetry }: {
  jobs: EvaluationJob[]
  versions: Checklist[]
  runs: Evaluation[]
  evidence?: Evidence
  starting: boolean
  failure?: { error: Error; versionId: string }
  onCancel: (id: string) => Promise<void>
  onRetry: (versionId: string) => void
}) {
  const { t } = useI18n()
  const [now, setNow] = useState(Date.now)
  const running = jobs.some((job) => job.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const latest = jobs[0]
  // A finished run stays here only until its saved result loads; the verdict pane shows it after that.
  const visible = jobs.filter((job) => active(job) ||
    (!starting && job === latest && (job.status === 'failed' || job.status === 'cancelled')) ||
    (evidence && job.status === 'succeeded' && job.progress?.judges.length &&
      job === latest && !runs.some((run) => run.id === job.evaluation_id)))

  return <>
    {starting && !visible.length && <p className="run-notice" role="status"><span className="spinner" /> {t('startingEvaluation')}</p>}
    {visible.map((job) => <JobProgress key={job.id} job={job} now={now} evidence={evidence}
      checklist={versions.find((version) => version.version_id === job.checklist_version_id)} onCancel={onCancel} onRetry={onRetry} />)}
    {failure && <div className="evaluation-error">
      <p className="inline-error" role="alert">{errorMessage(failure.error, t)}</p>
      <p className="form-note">{t('savedResultsAvailable')}</p>
      <button className="button button-outline" type="button" disabled={starting} onClick={() => onRetry(failure.versionId)}>{t('retryEvaluation')}</button>
    </div>}
  </>
}
