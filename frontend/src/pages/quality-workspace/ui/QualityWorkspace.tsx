import { useState } from 'react'
import { qualityApi } from '../../../entities/quality'
import type { Checklist, ConversationSummary, ImportResult } from '../../../entities/quality'
import { EditChecklist } from '../../../features/edit-checklist'
import { ImportDialog } from '../../../features/import-conversations'
import { isMockMode } from '../../../shared/config/apiMode'
import { useRemote } from '../../../shared/lib/useRemote'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import { ConversationDesk } from '../../../widgets/conversation-desk'
import './workspace.css'

function ConversationPicker({ items, selected, loading, error, onRetry, onSelect, onClose }: {
  items: ConversationSummary[]
  selected?: ConversationSummary
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelect: (item: ConversationSummary) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<'all' | 'chat' | 'call'>('all')
  const available = items.filter((item) => (channel === 'all' || item.channel === (channel === 'chat' ? 'agent chat' : 'voice call'))
    && [item.conversation_id, item.group_id, item.channel, item.language]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))

  return <Dialog title="Dialogues" kicker="CQA workspace" pending={false} onClose={onClose}>
    <label className="queue-search"><Icon name="search" size={18} /><span className="sr-only">Search dialogues</span>
      <input type="search" value={query} placeholder="Find by ID, group or language" onChange={(event) => setQuery(event.target.value)} />
    </label>
    <div className="queue-filters" role="group" aria-label="Filter by channel">
      {(['all', 'chat', 'call'] as const).map((value) => <button type="button" key={value} aria-pressed={channel === value} onClick={() => setChannel(value)}>{value === 'all' ? 'All' : value === 'chat' ? 'Chats' : 'Calls'}</button>)}
    </div>
    {error && <div className="workspace-alert"><p className="inline-error" role="alert">{error}</p><button className="button button-outline" onClick={onRetry}>Retry list</button></div>}
    {loading && <p className="queue-notice" role="status">Loading dialogues…</p>}
    <ul className="queue-list">
      {available.map((item) => <li key={item.key}>
        <button className="queue-item" type="button" aria-current={selected?.key === item.key ? 'true' : undefined} onClick={() => onSelect(item)}>
          <span className="queue-item-icon"><Icon name={item.channel === 'voice call' ? 'phone' : 'chat'} /></span>
          <span className="queue-item-copy"><strong>{item.conversation_id}</strong><span>{item.channel === 'voice call' ? 'Voice call' : 'Chat'} · Group {item.group_id}</span></span>
          <span className="queue-language">{item.language}</span><Icon name="chevron" size={17} />
        </button>
      </li>)}
    </ul>
    {!loading && !error && !available.length && <p className="queue-notice">{items.length ? 'No dialogues match your search.' : 'Import a group or a JSON transcript to get started.'}</p>}
  </Dialog>
}

export function QualityWorkspace() {
  const conversations = useRemote(qualityApi.listConversations)
  const checklists = useRemote(qualityApi.listChecklists)
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [running, setRunning] = useState(false)
  const [versionId, setVersionId] = useState('')
  const [savedVersions, setSavedVersions] = useState<Checklist[]>([])
  const [picker, setPicker] = useState(false)
  const [view, setView] = useState<'analysis' | 'appeals'>('analysis')

  const items = conversations.data?.items ?? []
  const versions = [...savedVersions, ...(checklists.data?.items ?? []).filter(
    (item) => !savedVersions.some((saved) => saved.version_id === item.version_id),
  )]
  const version = versions.find((item) => item.version_id === versionId) ?? versions[0]
  const selected = items.find((item) => item.key === selectedKey)
    ?? (selectedGroup ? items.find((item) => item.group_id === selectedGroup) : undefined)
    ?? (isMockMode ? items.find((item) => item.channel === 'voice call') : undefined)
    ?? items[0]

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
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className="app-rail" aria-label="Workspace sidebar">
      <button className="rail-brand" type="button" onClick={() => show('analysis')} aria-label="CQA home">
        <span className="brand-mark"><Icon name="waveform" size={21} /></span><span>CQA</span>
      </button>
      <nav className="rail-links" aria-label="Workspace">
        <button className="rail-link" type="button" disabled={running} aria-haspopup="dialog" onClick={() => setPicker(true)}><Icon name="chat" size={20} /><span>Dialogues</span></button>
        <EditChecklist checklist={version} disabled={running} onSaved={handleSaved} rail />
        <button className="rail-link" type="button" aria-current={view === 'appeals' ? 'page' : undefined} onClick={() => show('appeals')}><Icon name="scales" size={20} /><span>Appeals</span></button>
        <button className="rail-link" type="button" aria-current={view === 'analysis' ? 'page' : undefined} onClick={() => show('analysis')}><Icon name="chart" size={20} /><span>Analytics</span></button>
      </nav>
      <div className="rail-caption">Conversation<br />Quality Analytics</div>
    </aside>
    {picker && <ConversationPicker items={items} selected={selected} loading={conversations.loading} error={conversations.error}
      onRetry={conversations.refresh} onClose={() => setPicker(false)} onSelect={(item) => {
        setSelectedKey(item.key)
        setPicker(false)
        show('analysis')
      }} />}
    <main className="workspace" id="main" tabIndex={-1}>
      <div className="workspace-utility">
        <span className={`mode-badge ${isMockMode ? 'mode-synthetic' : 'mode-live'}`}><span className="mode-dot" />{isMockMode ? 'Synthetic mode' : 'Live API'}</span>
        <ImportDialog onImported={handleImport} disabled={running} />
      </div>
      {imported && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Group <strong>{imported.group_id}</strong> · {imported.imported} imported, {imported.skipped} skipped</p>}
      {savedVersions[0] && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Saved checklist version <strong>{savedVersions[0].version_id}</strong></p>}
      {checklists.error && <div className="workspace-alert"><p className="inline-error" role="alert">Could not load checklists. {checklists.error}</p><button className="button button-outline" onClick={checklists.refresh}>Retry checklists</button></div>}
      {conversations.error && !selected && <div className="workspace-alert"><p className="inline-error" role="alert">{conversations.error}</p><button className="button button-outline" onClick={conversations.refresh}>Retry dialogues</button></div>}
      {selected ? <ConversationDesk key={selected.key} summary={selected} versions={versions} version={version} view={view}
        loadingChecklists={checklists.loading} onSelectVersion={setVersionId} onRunningChange={setRunning} onAnalysis={() => show('analysis')} />
        : <div className="workspace-empty"><span className="empty-icon"><Icon name={view === 'appeals' ? 'scales' : 'chat'} size={24} /></span><h1>{conversations.loading ? 'Loading workspace…' : view === 'appeals' ? 'Appeals' : 'Conversation analysis'}</h1><p>{conversations.loading ? 'Retrieving dialogues.' : conversations.error ? 'Retry the dialogue list to continue.' : 'Import a group or upload a JSON transcript to get started.'}</p></div>}
    </main>
  </>
}
