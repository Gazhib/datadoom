import { useI18n } from '../../../shared/i18n/useI18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, EvaluationJob } from '../../../entities/quality'
import { UiError } from '../../../shared/i18n/messages'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'

const teamStorageKey = 'datadoom.results-team'

function rememberedTeam() {
  try { return localStorage.getItem(teamStorageKey) ?? '' } catch { return '' }
}

export function GroupActions({ items, groupId, version, jobs, supported, onGroup, onStart, onCancel }: {
  items: ConversationSummary[]
  groupId: string
  version?: Checklist
  jobs: EvaluationJob[]
  supported: boolean
  onGroup: (groupId: string) => void
  onStart: (groupId: string, versionId: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const groups = [...new Set(items.map((item) => item.group_id))]
  const conversations = items.filter((item) => item.group_id === groupId)
  const groupJobs = conversations.flatMap((item) => {
    const job = jobs.find((job) => job.conversation_key === item.key && job.checklist_version_id === version?.version_id)
    return job ? [job] : []
  })
  const done = groupJobs.filter((job) => job.status === 'succeeded').length
  const failed = groupJobs.filter((job) => job.status === 'failed').length
  const queued = groupJobs.filter((job) => job.status === 'queued')
  const running = groupJobs.filter((job) => job.status === 'running').length
  const cancelled = groupJobs.filter((job) => job.status === 'cancelled').length
  const [teamName, setTeamName] = useState(rememberedTeam)
  const [teamDialog, setTeamDialog] = useState(false)
  const [exportSupported, setExportSupported] = useState(true)
  const [exported, setExported] = useState<{ group: string; version: string } | null>(null)
  const { run, pending, error } = useMutation()

  async function download() {
    if (!version || !teamName.trim()) return
    const payload = await qualityApi.exportResults(groupId, version.version_id, teamName.trim())
    if (!payload) {
      setExportSupported(false)
      setTeamDialog(false)
      return
    }
    try { localStorage.setItem(teamStorageKey, teamName.trim()) } catch { /* Download remains available without browser storage. */ }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'results.json'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setTeamDialog(false)
    setExported({ group: groupId, version: version.version_id })
  }

  function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(download)
  }

  if (!groups.length) return null
  return <section className="group-toolbar" aria-label={t('groupEvaluations')}>
    <div className="group-toolbar-main">
      <label className="group-control"><Icon name="folder" size={16} /><span className="sr-only">{t('conversationGroup')}</span>
        <select value={groupId} onChange={(event) => onGroup(event.target.value)}>
          {groups.map((group) => <option key={group} value={group}>{t('groupName', { id: group })}</option>)}
        </select>
      </label>
      <span className="group-count">{t('conversationCount', { count: conversations.length })}</span>
      <div className="group-buttons">
        {supported && <button className="button button-outline" type="button" disabled={!version || pending || !!running || !!queued.length}
          onClick={() => { if (version) void run(() => onStart(groupId, version.version_id)) }}>
          <Icon name="layers" size={15} />{pending ? t('working') : t('evaluateGroup')}
        </button>}
        {!!queued.length && <button className="button button-outline" type="button" disabled={pending} onClick={() => {
          void run(async () => {
            const outcomes = await Promise.allSettled(queued.map((job) => onCancel(job.id)))
            const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
            if (rejected.length) throw new UiError('cancelQueuedFailed', { count: rejected.length })
          })
        }}>{t('cancelQueuedCount', { count: queued.length })}</button>}
        {exportSupported && <button className="button button-outline" type="button" disabled={!version || pending}
          onClick={() => { if (teamName.trim()) void run(download); else setTeamDialog(true) }}>
          <Icon name="file" size={15} /> {t('downloadResultsFile')}
        </button>}
      </div>
    </div>
    {!!groupJobs.length && <div className="group-progress" role="status">
      <progress value={done + failed + cancelled} max={conversations.length} aria-label={t('groupCompleted')} />
      <span>{t('groupProgress', { done, failed, running, queued: queued.length })}
        {cancelled > 0 && ` · ${t('cancelledCount', { count: cancelled })}`} / {conversations.length}</span>
    </div>}
    {(!exportSupported || exported) && <p className="form-note" role="status">
      {exportSupported && exported ? t('exportDownloaded', exported) : t('exportUnavailable')}
    </p>}
    {error && !teamDialog && <p className="inline-error" role="alert">{error}</p>}
    {teamDialog && <Dialog title={t('downloadResults')} kicker={t('organizerExport')} pending={pending} onClose={() => setTeamDialog(false)}>
      <p className="form-note">{t('exportDescription', { group: groupId, version: version?.version_id ?? '' })}</p>
      <form onSubmit={submitTeam}>
        <label className="field"><span className="field-label">{t('teamName')}</span>
          <input value={teamName} onChange={(event) => setTeamName(event.target.value)} required maxLength={200} disabled={pending} autoFocus />
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="button button-outline" type="button" disabled={pending} onClick={() => setTeamDialog(false)}>{t('cancel')}</button>
          <button className="button button-primary" type="submit" disabled={pending || !teamName.trim()}>{pending ? t('preparing') : t('downloadResultsFile')}</button></div>
      </form>
    </Dialog>}
  </section>
}
