import { useEffect, useState } from 'react'
import type { EvaluationJob } from '../../../entities/quality'
import { useMutation } from '../../../shared/lib/useMutation'
import { Icon } from '../../../shared/ui/Icon'
import './evaluation-progress.css'

const active = (job: EvaluationJob) => job.status === 'queued' || job.status === 'running'

function elapsed(startedAt: string | null, now: number) {
  const seconds = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function JobProgress({ job, now, onCancel, onRetry }: {
  job: EvaluationJob
  now: number
  onCancel: (id: string) => Promise<void>
  onRetry: (versionId: string) => void
}) {
  const { run, pending, error } = useMutation()
  const queued = job.status === 'queued'
  return <section className={`evaluation-progress progress-${job.status}`} aria-label={`Evaluation ${job.checklist_version_id}`}>
    <div className="progress-heading">
      <div className="progress-title">
        {active(job) ? <span className="spinner" aria-hidden="true" /> : <Icon name={job.status === 'failed' ? 'flag' : 'minus'} size={17} />}
        <strong role="status">{queued ? `Queued · ${job.queue_position && job.queue_position > 1 ? `${job.queue_position - 1} ahead` : 'next to run'}`
          : job.status === 'running' ? <>Running · <span aria-live="off">{elapsed(job.started_at, now)}</span></>
          : job.status === 'failed' ? 'Evaluation failed' : 'Evaluation cancelled'}</strong>
        <span className="progress-version">{job.checklist_version_id}</span>
      </div>
      {queued && <button className="button button-outline" type="button" disabled={pending}
        onClick={() => { void run(() => onCancel(job.id)) }}>{pending ? 'Cancelling…' : 'Cancel queued run'}</button>}
      {job.status === 'failed' && <button className="button button-outline" type="button" onClick={() => onRetry(job.checklist_version_id)}>Retry evaluation</button>}
    </div>
    {job.progress && <ul className="judge-progress" aria-label="Per-judge progress">
      {job.progress.judges.map((judge) => <li key={judge.name} className={`judge-progress-chip judge-${judge.status}`}
        aria-label={`${judge.name}: ${judge.status}${judge.seconds === null ? '' : `, ${judge.seconds.toFixed(1)} seconds`}`}>
        <span className="judge-state-mark" aria-hidden="true" />
        <strong>{judge.name}</strong><span>{judge.status}</span>
        {judge.seconds !== null && <span>{judge.seconds.toFixed(1)} s</span>}
      </li>)}
    </ul>}
    {job.error && <p className="inline-error" role="alert">{job.error.message}</p>}
    {job.id.startsWith('sync-') && <p className="form-note">Keep this tab open to receive the result from this backend. You can continue browsing the workspace.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>
}

export function EvaluationProgress({ jobs, starting, failure, onCancel, onRetry }: {
  jobs: EvaluationJob[]
  starting: boolean
  failure?: { message: string; versionId: string }
  onCancel: (id: string) => Promise<void>
  onRetry: (versionId: string) => void
}) {
  const [now, setNow] = useState(Date.now)
  const running = jobs.some((job) => job.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const visible = jobs.filter(active)
  const latest = jobs[0]
  if (!starting && latest && (latest.status === 'failed' || latest.status === 'cancelled')) visible.push(latest)

  return <>
    {starting && !visible.length && <p className="run-notice" role="status"><span className="spinner" /> Starting evaluation…</p>}
    {visible.map((job) => <JobProgress key={job.id} job={job} now={now} onCancel={onCancel} onRetry={onRetry} />)}
    {failure && <div className="evaluation-error">
      <p className="inline-error" role="alert">{failure.message}</p>
      <p className="form-note">Saved results remain available.</p>
      <button className="button button-outline" type="button" disabled={starting} onClick={() => onRetry(failure.versionId)}>Retry evaluation</button>
    </div>}
  </>
}
