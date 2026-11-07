import { useI18n } from '../../../shared/i18n/useI18n'
import { useEffect, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { JudgeStatus } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'

export function JudgeAvailability() {
  const { t } = useI18n()
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
  const caption = unavailable ? t('judgeStatusUnavailable') : problem
    ? `${problem.name} · ${t(problem.reachable ? 'modelMissing' : 'offline')}${problem.fallback_reachable ? ` · ${t('fallbackReachable')}` : ''}`
    : t('judgesOnline', { online, total: status?.judges.length ?? 0 })
  const execution = status?.execution === 'sequential' ? t('executionSequential')
    : status?.execution === 'parallel' ? t('executionParallel') : status?.execution
  return <details className={`judge-availability${unavailable || problem ? ' judge-availability-warning' : ''}`}>
    <summary><Icon name="globe" size={14} /><span>{caption}</span><Icon name="down" size={12} /></summary>
    <div className="judge-availability-popover">
      <strong>{t('judgeLaptops')}</strong>
      {unavailable ? <p role="status">{t('availabilityRetry')}</p> : status && <>
        <p>{t('execution', { execution: execution ?? '' })} · {t('quorum', { count: status.quorum })}</p>
        <ul>{status.judges.map((judge) => <li key={judge.name}>
          <strong>{judge.name} · {judge.reachable ? judge.model_available === false ? t('modelMissing') : judge.model_available === null ? t('modelUnverified') : t('online') : t('offline')}</strong>
          <span>{judge.provider} / {judge.model}</span><span>{judge.host}</span>
          {judge.fallback_host && <span>{t('fallbackHost', { host: judge.fallback_host })} · {t(judge.fallback_reachable === null ? 'notChecked' : judge.fallback_reachable ? 'reachable' : 'unreachable')}</span>}
        </li>)}</ul>
      </>}
    </div>
  </details>
}
