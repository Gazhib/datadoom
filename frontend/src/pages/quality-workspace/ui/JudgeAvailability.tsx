import { useEffect, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { JudgeStatus } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'

export function JudgeAvailability() {
  const [status, setStatus] = useState<JudgeStatus | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    let supported = true
    async function refresh() {
      if (pending || !supported) return
      pending = true
      clearTimeout(timer)
      try {
        const result = await qualityApi.getJudges(controller.signal)
        if (controller.signal.aborted) return
        supported = result !== null
        setStatus(result)
        setUnavailable(false)
      } catch {
        if (!controller.signal.aborted) setUnavailable(true)
      } finally {
        pending = false
        if (!controller.signal.aborted && supported) timer = setTimeout(() => { void refresh() }, 30_000)
      }
    }
    const wake = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    document.addEventListener('visibilitychange', wake)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [])

  if (!status && !unavailable) return null
  const online = status?.judges.filter((judge) => judge.reachable && judge.model_available !== false).length ?? 0
  const problem = status?.judges.find((judge) => !judge.reachable || judge.model_available === false)
  const caption = unavailable ? 'Judge status unavailable' : problem
    ? `${problem.name} ${!problem.reachable ? 'offline' : 'model missing'}${problem.fallback_reachable ? ' · fallback reachable' : ''}`
    : `${online}/${status?.judges.length ?? 0} judge laptops online`
  return <details className={`judge-availability${unavailable || problem ? ' judge-availability-warning' : ''}`}>
    <summary><Icon name="globe" size={14} /><span>{caption}</span><Icon name="down" size={12} /></summary>
    <div className="judge-availability-popover">
      <strong>Judge laptops</strong>
      {unavailable ? <p role="status">Could not refresh availability. Retrying every 30 seconds.</p> : <>
        <p>{status?.execution} execution · Quorum {status?.quorum}</p>
        <ul>{status?.judges.map((judge) => <li key={judge.name}>
          <strong>{judge.name} · {judge.reachable ? judge.model_available === false ? 'Model missing' : judge.model_available === null ? 'Online · model unverified' : 'Online' : 'Offline'}</strong>
          <span>{judge.provider} / {judge.model}</span><span>{judge.host}</span>
          {judge.fallback_host && <span>Fallback {judge.fallback_host} · {judge.fallback_reachable === null ? 'not checked' : judge.fallback_reachable ? 'reachable' : 'unreachable'}</span>}
        </li>)}</ul>
      </>}
    </div>
  </details>
}
