import { useEffect, useRef, useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, ImportResult } from '../../../entities/quality'
import { EditChecklist } from '../../../features/edit-checklist'
import { ImportDialog } from '../../../features/import-conversations'
import { isMockMode } from '../../../shared/config/apiMode'
import { useI18n } from '../../../shared/i18n/useI18n'
import { localeNames } from '../../../shared/i18n/messages'
import type { Locale } from '../../../shared/i18n/messages'
import { errorMessage } from '../../../shared/lib/errorMessage'
import { useRemote } from '../../../shared/lib/useRemote'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import { ConversationDesk } from '../../../widgets/conversation-desk'
import { isActiveJob, useEvaluationJobs } from '../model/useEvaluationJobs'
import { GroupActions } from './GroupActions'
import { JudgeAvailability } from './JudgeAvailability'
import './workspace.css'

const conversationLanguages = { RU: 'russian', KZ: 'kazakh', EN: 'english' } as const
const conversationLocales = { RU: 'ru', KZ: 'kk', EN: 'en' } as const

function ConversationPicker({ items, selected, loading, error, onRetry, onSelect, onClose }: {
  items: ConversationSummary[]
  selected?: ConversationSummary
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelect: (item: ConversationSummary) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const searchInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<'all' | 'chat' | 'call'>('all')
  const search = query.trim().toLowerCase()
  const available = items.filter((item) => {
    if (channel !== 'all' && item.channel !== (channel === 'chat' ? 'agent chat' : 'voice call')) return false
    const language = conversationLanguages[item.language]
    return [item.conversation_id, item.group_id, item.channel, item.language, t(language),
      localeNames[conversationLocales[item.language]], t(item.channel === 'voice call' ? 'voiceCall' : 'chat')]
      .some((value) => value.toLowerCase().includes(search))
  })

  return <Dialog title={t('conversations')} kicker={t('workspaceName')} pending={false} initialFocus={searchInput} onClose={onClose}>
    <label className="queue-search"><Icon name="search" size={18} /><span className="sr-only">{t('searchConversations')}</span>
      <input ref={searchInput} type="search" value={query} placeholder={t('searchConversationsHint')} onChange={(event) => setQuery(event.target.value)} />
    </label>
    <div className="queue-filters" role="group" aria-label={t('filterChannel')}>
      {(['all', 'chat', 'call'] as const).map((value) => <button type="button" key={value} aria-pressed={channel === value} onClick={() => setChannel(value)}>{value === 'all' ? t('all') : value === 'chat' ? t('chats') : t('calls')}</button>)}
    </div>
    {error && <div className="workspace-alert"><p className="inline-error" role="alert">{error}</p><button className="button button-outline" onClick={onRetry}>{t('retryList')}</button></div>}
    {loading && <p className="queue-notice" role="status">{t('loadingConversations')}</p>}
    <ul className="queue-list">
      {available.map((item) => <li key={item.key}>
        <button className="queue-item" type="button" aria-current={selected?.key === item.key ? 'true' : undefined} onClick={() => onSelect(item)}>
          <span className="queue-item-icon"><Icon name={item.channel === 'voice call' ? 'phone' : 'chat'} /></span>
          <span className="queue-item-copy"><strong>{item.conversation_id}</strong>
            <span>{t(item.channel === 'voice call' ? 'voiceCall' : 'chat')} · {t('groupName', { id: item.group_id })} · {t(conversationLanguages[item.language])}</span>
            {item.latest && <span className={`queue-latest${item.latest.serious_error ? ' queue-latest-flag' : ''}`}>
              {item.latest.total === null ? t('noScore') : `${item.latest.total.toFixed(2)} / 100`} · {item.latest.serious_error ? t('seriousError') : t('noSeriousErrors')} · {item.latest.checklist_version_id}
            </span>}
          </span>
          {selected?.key === item.key ? <span className="queue-current">{t('current')}</span> : <Icon name="chevron" size={17} />}
        </button>
      </li>)}
    </ul>
    {!loading && !error && !available.length && <p className="queue-notice" role="status">{t(items.length ? 'noMatchingConversations' : 'importToStart')}</p>}
  </Dialog>
}

export function QualityWorkspace() {
  const { locale, setLocale, t } = useI18n()
  const conversations = useRemote(qualityApi.listConversations)
  const checklists = useRemote(qualityApi.listChecklists)
  const [selectedKey, setSelectedKey] = useState(() => new URLSearchParams(location.search).get('c') ?? '')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [versionId, setVersionId] = useState(() => new URLSearchParams(location.search).get('v') ?? '')
  const [savedVersions, setSavedVersions] = useState<Checklist[]>([])
  const [picker, setPicker] = useState(false)
  const switchButton = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<'analysis' | 'appeals'>(() => new URLSearchParams(location.search).get('view') === 'appeals' ? 'appeals' : 'analysis')

  const items = conversations.data?.items ?? []
  const versions = [...savedVersions, ...(checklists.data?.items ?? []).filter(
    (item) => !savedVersions.some((saved) => saved.version_id === item.version_id),
  )]
  const version = versions.find((item) => item.version_id === versionId) ?? versions[0]
  const selected = items.find((item) => item.key === selectedKey)
    ?? (selectedGroup ? items.find((item) => item.group_id === selectedGroup) : undefined)
    ?? (isMockMode ? items.find((item) => item.channel === 'voice call') : undefined)
    ?? items[0]
  const evaluations = useEvaluationJobs(selected?.key)
  const activeJobs = evaluations.jobs.filter(isActiveJob)
  const pickerItems = items.map((item) => {
    // completed is newest first, including results received while another conversation was open.
    const completed = evaluations.completed.find((evaluation) => evaluation.conversation_key === item.key)
    const latest = evaluations.reviewed.find((evaluation) => evaluation.id === (completed?.id ?? item.latest?.evaluation_id)) ?? completed
    return latest ? { ...item, latest: {
      evaluation_id: latest.id, checklist_version_id: latest.checklist.version_id, mode: latest.mode,
      total: latest.final.total, serious_error: latest.final.serious_error,
    } } : item
  })

  const selectedConversationKey = selected?.key
  const selectedVersionId = version?.version_id
  useEffect(() => {
    if (!selectedConversationKey) return
    const url = new URL(location.href)
    url.searchParams.set('c', selectedConversationKey)
    if (selectedVersionId) url.searchParams.set('v', selectedVersionId)
    if (view === 'appeals') url.searchParams.set('view', 'appeals')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }, [selectedConversationKey, selectedVersionId, view])

  function show(next: typeof view) {
    setView(next)
    requestAnimationFrame(() => {
      const main = document.getElementById('main')
      main?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
  }

  function handleImport(result: ImportResult) {
    setImported(result)
    if (result.imported > 0) {
      setSelectedKey('')
      setSelectedGroup(result.group_id)
      setView('analysis')
    }
    conversations.refresh()
  }

  function handleSaved(checklist: Checklist) {
    setSavedVersions((previous) => [checklist, ...previous])
    setVersionId(checklist.version_id)
  }

  return <>
    <a className="skip-link" href="#main">{t('skipToWorkspace')}</a>
    <header className="app-header">
      <div className="app-header-inner">
        <button className="app-brand" type="button" onClick={() => show('analysis')} aria-label={t('home')}>
          <span className="brand-mark"><Icon name="waveform" size={23} /></span>
          <span className="brand-copy"><strong>CQA</strong><span>{t('brandDescription')}</span></span>
        </button>
        <nav className="app-nav" aria-label={t('workspace')}>
          <button className="nav-button" type="button" aria-current={view === 'analysis' ? 'page' : undefined} onClick={() => show('analysis')}><Icon name="chart" size={17} /><span>{t('review')}</span></button>
          <EditChecklist checklist={version} disabled={false} onSaved={handleSaved} navigation />
          <button className="nav-button" type="button" aria-current={view === 'appeals' ? 'page' : undefined} onClick={() => show('appeals')}><Icon name="scales" size={17} /><span>{t('appeals')}</span></button>
        </nav>
        <div className="workspace-utility">
          <span className={`mode-badge ${isMockMode ? 'mode-synthetic' : 'mode-live'}`}><span className="mode-dot" />{isMockMode ? t('demoMode') : t('liveApi')}</span>
          <label className="locale-control">
            <Icon name="globe" size={16} />
            <span className="sr-only">{t('interfaceLanguage')}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              {Object.entries(localeNames).map(([value, label]) => <option value={value} lang={value} key={value}>{label}</option>)}
            </select>
          </label>
          <ImportDialog onImported={handleImport} disabled={false} />
        </div>
      </div>
      <div className="workspace-health">
        <JudgeAvailability />
        {!!activeJobs.length && <button className="running-indicator" type="button" onClick={() => {
          const currentIndex = activeJobs.findIndex((job) => job.conversation_key === selected?.key)
          const job = activeJobs[(currentIndex + 1) % activeJobs.length]
          setSelectedKey(job.conversation_key)
          setVersionId(job.checklist_version_id)
          show('analysis')
        }}><span className="spinner" aria-hidden="true" />{t('jobsInProgress', { count: activeJobs.length })}<Icon name="arrow" size={13} /></button>}
      </div>
    </header>
    {picker && <ConversationPicker items={pickerItems} selected={selected} loading={conversations.loading} error={conversations.error}
      onRetry={conversations.refresh} onClose={() => setPicker(false)} onSelect={(item) => {
        setSelectedKey(item.key)
        setPicker(false)
        setView('analysis')
        requestAnimationFrame(() => switchButton.current?.focus())
      }} />}
    <main className="workspace" id="main" tabIndex={-1}>
      {imported && <p className="workspace-status" role="status"><Icon name="check" size={17} /> {t('importStatus', { group: imported.group_id, imported: imported.imported, skipped: imported.skipped })}</p>}
      {savedVersions[0] && <p className="workspace-status" role="status"><Icon name="check" size={17} /> {t('checklistSaved', { version: savedVersions[0].version_id })}</p>}
      {checklists.error && <div className="workspace-alert"><p className="inline-error" role="alert">{t('checklistsLoadFailed')} {checklists.error}</p><button className="button button-outline" onClick={checklists.refresh}>{t('retryChecklists')}</button></div>}
      {conversations.error && !selected && <div className="workspace-alert"><p className="inline-error" role="alert">{conversations.error}</p><button className="button button-outline" onClick={conversations.refresh}>{t('retryConversations')}</button></div>}
      {evaluations.pollError && <div className="workspace-alert"><p className="inline-error" role="alert">{t('progressRefreshFailed')} {errorMessage(evaluations.pollError, t)} {t('retryInTenSeconds')}</p><button className="button button-outline" type="button" onClick={evaluations.refresh}>{t('refreshProgress')}</button></div>}
      <section className="conversation-switcher" aria-label={t('currentConversation')}>
        <div className="conversation-switcher-context">
          <span className="conversation-switcher-icon"><Icon name={selected?.channel === 'voice call' ? 'phone' : 'chat'} size={22} /></span>
          <div className="conversation-switcher-copy" aria-live="polite">
            <span className="kicker">{t('currentConversation')}</span>
            <strong>{selected?.conversation_id ?? t(conversations.loading ? 'loadingConversations' : 'noConversationSelected')}</strong>
            {selected && <span className="conversation-switcher-meta">
              {t(selected.channel === 'voice call' ? 'voiceCall' : 'chat')} · {t(conversationLanguages[selected.language])} · {t('groupName', { id: selected.group_id })}
            </span>}
          </div>
        </div>
        <button ref={switchButton} className="button button-primary" type="button" aria-haspopup="dialog"
          onClick={() => setPicker(true)}>
          {t(selected ? 'switchConversation' : 'chooseConversation')} <Icon name="down" size={16} />
        </button>
      </section>
      <GroupActions items={items} groupId={selected?.group_id ?? ''} version={version} jobs={evaluations.jobs} supported={evaluations.groupSupported}
        onGroup={(groupId) => {
          setSelectedGroup(groupId)
          setSelectedKey(items.find((item) => item.group_id === groupId)?.key ?? '')
          show('analysis')
        }} onStart={evaluations.startGroup} onCancel={evaluations.cancel} />
      {selected ? <ConversationDesk key={selected.key} summary={selected} versions={versions} version={version} view={view}
        loadingChecklists={checklists.loading} onSelectVersion={setVersionId} onAnalysis={() => show('analysis')}
        jobs={evaluations.jobs.filter((job) => job.conversation_key === selected.key)}
        completed={evaluations.completed.filter((evaluation) => evaluation.conversation_key === selected.key)}
        reviewed={evaluations.reviewed.filter((evaluation) => evaluation.conversation_key === selected.key)}
        starting={!!version && evaluations.isStarting(selected.key, version.version_id)} failure={evaluations.failures[selected.key]}
        onRun={(versionId) => { void evaluations.start(selected.key, versionId) }} onCancel={evaluations.cancel} onUpdated={evaluations.updateEvaluation} />
        : <div className="workspace-empty"><span className="empty-icon"><Icon name={view === 'appeals' ? 'scales' : 'chat'} size={24} /></span><h1>{conversations.loading ? t('loadingWorkspace') : view === 'appeals' ? t('appeals') : t('conversationReview')}</h1><p>{conversations.loading ? t('retrievingConversations') : conversations.error ? t('retryListToContinue') : t('importToStart')}</p></div>}
    </main>
  </>
}
