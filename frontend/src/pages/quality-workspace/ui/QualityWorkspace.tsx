import { useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ImportResult } from '../../../entities/quality'
import { EditChecklist } from '../../../features/edit-checklist'
import { ImportDialog } from '../../../features/import-conversations'
import { isMockMode } from '../../../shared/config/apiMode'
import { useRemote } from '../../../shared/lib/useRemote'
import { Icon } from '../../../shared/ui/Icon'
import { ConversationDesk } from '../../../widgets/conversation-desk'
import './workspace.css'

export function QualityWorkspace() {
  const conversations = useRemote(qualityApi.listConversations)
  const checklists = useRemote(qualityApi.listChecklists)
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<'all' | 'chat' | 'call'>('all')
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [running, setRunning] = useState(false)
  const [versionId, setVersionId] = useState('')
  const [savedVersions, setSavedVersions] = useState<Checklist[]>([])

  const items = conversations.data?.items ?? []
  const versions = [...savedVersions, ...(checklists.data?.items ?? []).filter(
    (item) => !savedVersions.some((saved) => saved.version_id === item.version_id),
  )]
  const version = versions.find((item) => item.version_id === versionId) ?? versions[0]
  const lastSaved = savedVersions[0]
  const available = items.filter((item) => (channel === 'all' || item.channel === (channel === 'chat' ? 'agent chat' : 'voice call'))
    && [item.conversation_id, item.group_id, item.channel, item.language]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))
  const selected = items.find((item) => item.key === selectedKey) ?? items.find((item) => item.group_id === selectedGroup) ?? items[0]
  const chatCount = items.filter((item) => item.channel === 'agent chat').length
  const languages = [...new Set(items.map((item) => item.language))]
  const count = (value: number) => conversations.loading ? '—' : String(value).padStart(2, '0')

  function handleImport(result: ImportResult) {
    setImported(result)
    if (result.imported > 0) {
      setSelectedKey('')
      setSelectedGroup(result.group_id)
      setQuery('')
      setChannel('all')
    }
    conversations.refresh()
  }

  function handleSaved(checklist: Checklist) {
    setSavedVersions((previous) => [checklist, ...previous])
    setVersionId(checklist.version_id)
  }

  return <>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className="app-rail" aria-label="Workspace navigation">
      <a className="rail-logo" href="#main" aria-label="Datadoom home"><Icon name="waveform" size={26} /></a>
      <nav className="rail-links" aria-label="Sections">
        <a className="rail-link" href="#workspace-overview" aria-label="Workspace overview" title="Workspace overview"><Icon name="grid" size={21} /><span>Overview</span></a>
        <a className="rail-link rail-link-active" href="#review-queue" aria-label="Conversation review" aria-current="page" title="Conversation review"><Icon name="chat" size={22} /><span>Review</span></a>
        <a className="rail-link" href="#workspace-guide" aria-label="Review guide" title="Review guide"><Icon name="book" size={21} /><span>Guide</span></a>
      </nav>
      <div className="rail-bottom"><span className="rail-monogram" title="Quality analyst workspace">QA</span><span className="rail-version">v.01</span></div>
    </aside>
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#main">datadoom<span className="brand-period">®</span></a>
        <p className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>Conversations</strong></p>
        <div className="header-context"><span className={`mode-badge ${isMockMode ? 'mode-synthetic' : 'mode-live'}`}><span className="mode-dot" />{isMockMode ? 'Synthetic mode' : 'Live API'}</span><span className="header-role">Quality analyst</span></div>
      </div>
    </header>
    <main className="workspace" id="main" tabIndex={-1}>
      <div className="intro" id="workspace-overview">
        <div><p className="eyebrow"><span />A LITTLE CONTEXT. A LOT OF CLARITY.</p><h1>Conversation review<span>.</span></h1><p className="intro-copy">Better conversations start with a closer look.</p></div>
        <div className="intro-actions">
          <EditChecklist checklist={version} disabled={running} onSaved={handleSaved} />
          <ImportDialog onImported={handleImport} disabled={running} />
        </div>
      </div>
      <section className="workspace-overview" aria-label="Workspace overview">
        <div className="overview-stat"><div className="stat-label">All conversations<Icon name="chat" size={17} /></div><div className="stat-value">{count(items.length)}<span>in your workspace</span></div></div>
        <div className="overview-stat"><div className="stat-label">Agent chats<Icon name="file" size={17} /></div><div className="stat-value">{count(chatCount)}<span>text conversations</span></div></div>
        <div className="overview-stat"><div className="stat-label">Voice calls<Icon name="waveform" size={18} /></div><div className="stat-value">{count(items.length - chatCount)}<span>call transcripts</span></div></div>
        <div className="overview-stat"><div className="stat-label">Languages<Icon name="globe" size={17} /></div><div className="stat-value">{count(languages.length)}<span>{languages.join(' / ') || 'No languages yet'}</span></div></div>
      </section>
      <div className="review-section-heading" id="review-queue"><h2>The review desk <span>/</span></h2><p>Every score has a story. Follow the evidence.</p><span className="desk-status"><span />{conversations.loading ? 'Loading workspace' : `${items.length} conversations available`}</span></div>
      <div className="review-layout">
      <section className="queue" aria-labelledby="queue-heading">
        <div className="queue-header">
          <div className="queue-heading"><h2 id="queue-heading">Conversations</h2><span className="count-chip">{available.length}</span></div>
          <label className="search"><Icon name="search" size={16} /><span className="sr-only">Search conversations</span><input type="search" value={query} placeholder="Find a conversation…" onChange={(event) => setQuery(event.target.value)} /><span className="search-hint" aria-hidden="true">⌕</span></label>
          <div className="queue-filters" role="group" aria-label="Filter by channel">
            {(['all', 'chat', 'call'] as const).map((value) => <button type="button" key={value} aria-pressed={channel === value} onClick={() => setChannel(value)}>{value === 'all' ? 'All' : value === 'chat' ? 'Chats' : 'Calls'}</button>)}
          </div>
        </div>
        {conversations.error && <div className="queue-notice"><p className="inline-error" role="alert">{conversations.error}</p><button className="button button-outline" onClick={conversations.refresh}>Retry list</button></div>}
        {conversations.loading && <p className="queue-notice" role="status">Loading conversations…</p>}
        <ul className="queue-list">
          {available.map((item) => <li key={item.key}>
            <button className="queue-item" type="button" aria-current={selected?.key === item.key ? 'true' : undefined} disabled={running} onClick={() => setSelectedKey(item.key)}>
              <span className="queue-item-type"><Icon name={item.channel === 'voice call' ? 'phone' : 'chat'} size={14} />{item.channel === 'voice call' ? 'Voice call' : 'Agent chat'}</span>
              <span className="queue-language">{item.language}</span>
              <span className="queue-item-copy"><strong>{item.conversation_id}</strong><span>Group {item.group_id}</span></span>
              <Icon name="arrowUpRight" size={17} />
            </button>
          </li>)}
        </ul>
        {!conversations.loading && !conversations.error && !available.length && <p className="queue-notice">{items.length ? 'No conversations match your search.' : 'No conversations imported yet.'}</p>}
        <div className="queue-guide" id="workspace-guide"><span className="guide-icon"><Icon name="link" size={21} /></span><p className="kicker">From score to source</p><h3>See the whole story.</h3><p>Select an evidence link to jump to the exact moment in the conversation.</p><span className="guide-line" aria-hidden="true"><i /><i /><i /><Icon name="arrow" size={15} /></span></div>
        <div className="queue-footer"><span className="mode-dot" /><span>{isMockMode ? 'Synthetic records · Demo workspace' : 'Imported records · Live workspace'}</span></div>
      </section>
      <div className="workspace-main">
        {imported && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Group <strong>{imported.group_id}</strong> · {imported.imported} imported, {imported.skipped} skipped</p>}
        {lastSaved && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Saved checklist version <strong>{lastSaved.version_id}</strong></p>}
        {checklists.error && <div className="workspace-alert"><p className="inline-error" role="alert">Could not load checklists. {checklists.error}</p><button className="button button-outline" onClick={checklists.refresh}>Retry checklists</button></div>}
        {selected ? <ConversationDesk key={selected.key} summary={selected} versions={versions} version={version}
          loadingChecklists={checklists.loading} onSelectVersion={setVersionId} onRunningChange={setRunning} />
          : <div className="workspace-empty"><span className="empty-icon"><Icon name="layers" size={25} /></span><h2>{conversations.loading ? 'Loading workspace…' : 'No conversation selected'}</h2><p>{conversations.error ? 'Retry the conversation list to continue.' : 'Import a group or upload a JSON transcript to get started.'}</p></div>}
      </div>
      </div>
      <footer className="workspace-footer"><span>Made for a closer look.</span><span>datadoom <span>—</span> Conversation quality intelligence</span></footer>
    </main>
  </>
}
