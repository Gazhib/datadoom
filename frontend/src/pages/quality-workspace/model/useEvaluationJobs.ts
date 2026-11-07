import { useCallback, useEffect, useRef, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Evaluation, EvaluationJob } from '../../../entities/quality'
import { errorMessage } from '../../../shared/lib/errorMessage'

export const isActiveJob = (job: EvaluationJob) => job.status === 'queued' || job.status === 'running'
const pairKey = (key: string, version: string) => JSON.stringify([key, version])
type RunFailure = { message: string; versionId: string }

// The page owns runs so switching conversations never tears down an evaluation.
export function useEvaluationJobs(conversationKey?: string) {
  const [jobs, setJobs] = useState<EvaluationJob[]>([])
  const jobsRef = useRef<EvaluationJob[]>([])
  const [completed, setCompleted] = useState<Evaluation[]>([])
  const [reviewed, setReviewed] = useState<Evaluation[]>([])
  const loaded = useRef(new Set<string>())
  const watched = useRef(new Set<string>())
  const [legacyJobs, setLegacyJobs] = useState<EvaluationJob[]>([])
  const [starting, setStarting] = useState<string[]>([])
  const inFlight = useRef(new Set<string>())
  const [failures, setFailures] = useState<Record<string, RunFailure | undefined>>({})
  const [pollError, setPollError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [groupSupported, setGroupSupported] = useState(true)
  const mounted = useRef(true)

  const mergeJobs = useCallback((incoming: EvaluationJob[]) => {
    const byId = new Map(jobsRef.current.map((job) => [job.id, job]))
    for (const job of incoming) {
      if (isActiveJob(job)) watched.current.add(job.id)
      const previous = byId.get(job.id)
      if (!previous || isActiveJob(previous) || !isActiveJob(job)) byId.set(job.id, job)
    }
    const next = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
    jobsRef.current = next
    setJobs(next)
    return next
  }, [])

  const rememberEvaluation = useCallback((evaluation: Evaluation) => {
    loaded.current.add(evaluation.id)
    setCompleted((previous) => [evaluation, ...previous.filter((item) => item.id !== evaluation.id)])
  }, [])

  const updateEvaluation = useCallback((evaluation: Evaluation) => {
    setReviewed((previous) => [evaluation, ...previous.filter((item) => item.id !== evaluation.id)])
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    let initial = true

    async function poll() {
      try {
        const requests = [qualityApi.listEvaluationJobs(initial ? {} : { active: true }, signal)]
        if (initial && conversationKey) {
          requests.push(qualityApi.listEvaluationJobs({ conversation_key: conversationKey, active: true }, signal))
        }
        // Active listings omit just-finished jobs, so also resolve every tracked active ID.
        for (const job of jobsRef.current.filter(isActiveJob)) {
          requests.push(qualityApi.getEvaluationJob(job.id, signal).then((item) => ({ items: [item] })))
        }
        const results = await Promise.allSettled(requests)
        if (signal.aborted) return
        const successful = results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : [])
        const current = mergeJobs(successful)
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length) throw failures[0].reason
        initial = false
        const latestSaved = current.find((job) => job.conversation_key === conversationKey && job.status === 'succeeded')
        const evaluations = await Promise.allSettled(current
          .filter((job) => job.status === 'succeeded' && job.evaluation_id && !loaded.current.has(job.evaluation_id) &&
            (watched.current.has(job.id) || job.id === latestSaved?.id))
          .map((job) => qualityApi.getEvaluation(job.evaluation_id!, signal)))
        if (signal.aborted) return
        // The newest job stays first when more than one finishes between polls.
        for (const result of [...evaluations].reverse()) {
          if (result.status === 'fulfilled') rememberEvaluation(result.value)
        }
        const failed = evaluations.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
        setPollError(null)
        if (current.some(isActiveJob)) timer = setTimeout(() => { void poll() }, 2000)
      } catch (error) {
        if (signal.aborted) return
        setPollError(errorMessage(error))
        timer = setTimeout(() => { void poll() }, 10_000)
      }
    }

    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [conversationKey, revision, mergeJobs, rememberEvaluation])

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('storage', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('storage', wake)
    }
  }, [])

  async function start(key: string, versionId: string) {
    const pair = pairKey(key, versionId)
    if (inFlight.current.has(pair) || jobsRef.current.some((job) =>
      isActiveJob(job) && job.conversation_key === key && job.checklist_version_id === versionId)) return
    inFlight.current.add(pair)
    setStarting([...inFlight.current])
    setFailures((previous) => ({ ...previous, [key]: undefined }))
    const legacyId = `sync-${crypto.randomUUID()}`
    try {
      const job = await qualityApi.startEvaluationJob(key, versionId)
      if (job) {
        if (mounted.current) {
          mergeJobs([job])
          setRevision((value) => value + 1)
        }
      } else {
        if (mounted.current) {
          setGroupSupported(false)
          setLegacyJobs((previous) => [...previous, {
            id: legacyId, conversation_key: key, checklist_version_id: versionId, status: 'running',
            created_at: new Date().toISOString(), started_at: new Date().toISOString(), finished_at: null,
            queue_position: null, progress: null, evaluation_id: null, error: null,
          }])
        }
        const evaluation = await qualityApi.evaluate(key, versionId)
        if (mounted.current) rememberEvaluation(evaluation)
      }
    } catch (error) {
      if (mounted.current) setFailures((previous) => ({ ...previous, [key]: { message: errorMessage(error), versionId } }))
    } finally {
      inFlight.current.delete(pair)
      if (mounted.current) {
        setStarting([...inFlight.current])
        setLegacyJobs((previous) => previous.filter((job) => job.id !== legacyId))
      }
    }
  }

  async function startGroup(groupId: string, versionId: string) {
    const result = await qualityApi.startGroupEvaluation(groupId, versionId)
    if (!mounted.current) return
    if (!result) {
      setGroupSupported(false)
      throw new Error('Group evaluation is unavailable on this backend. Run conversations individually.')
    }
    mergeJobs(result.items)
    setRevision((value) => value + 1)
  }

  async function cancel(id: string) {
    const job = await qualityApi.cancelEvaluationJob(id)
    if (mounted.current) {
      mergeJobs([job])
      setRevision((value) => value + 1)
    }
  }

  const allJobs = [...legacyJobs, ...jobs]
  return {
    jobs: allJobs, completed, reviewed, failures, pollError, groupSupported, start, startGroup, cancel, updateEvaluation,
    refresh: () => setRevision((value) => value + 1),
    isStarting: (key: string, versionId: string) => starting.includes(pairKey(key, versionId)),
  }
}
