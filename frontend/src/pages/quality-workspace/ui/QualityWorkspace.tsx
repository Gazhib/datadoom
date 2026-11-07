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
  const available = items.filter((item) => [item.conversation_id, item.group_id, item.channel, item.language]
    .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))
  const selected = items.find((item) => item.key === selectedKey) ?? items.find((item) => item.group_id === selectedGroup) ?? items[0]

  function handleImport(result: ImportResult) {
    setImported(result)
    if (result.imported > 0) {
      setSelectedKey('')
      setSelectedGroup(result.group_id)
      setQuery('')
    }
    conversations.refresh()
  }

  function handleSaved(checklist: Checklist) {
    setSavedVersions((previous) => [checklist, ...previous])
    setVersionId(checklist.version_id)
  }

  return <>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="app-header">
      <div className="header-inner">
        <div className="brand"><span className="brand-mark"><Icon name="activity" size={23} /></span><span>datadoom<span className="brand-period">.</span></span></div>
        <div className="header-context">
          <p className="breadcrumbs"><Icon name="layers" size={17} /> <span>Quality workspace</span><Icon name="chevron" size={13} /><strong>Conversation review</strong></p>
          <span className={`mode-badge ${isMockMode ? 'mode-synthetic' : 'mode-live'}`}><span className="mode-dot" />{isMockMode ? 'Synthetic mode' : 'Live API'}</span>
        </div>
      </div>
    </header>
    <main className="workspace" id="main" tabIndex={-1}>
      <div className="intro">
        <div><h1>Conversation review</h1><p className="intro-copy">Review quality scores alongside the turns that support them.</p></div>
        <div className="intro-actions">
          <EditChecklist checklist={version} disabled={running} onSaved={handleSaved} />
          <ImportDialog onImported={handleImport} disabled={running} />
        </div>
      </div>
      <section className="queue" aria-labelledby="queue-heading">
        <div className="queue-header">
          <div className="queue-heading"><h2 id="queue-heading">Conversations</h2><span className="count-chip">{items.length}</span></div>
          <label className="search"><Icon name="search" size={17} /><span className="sr-only">Search conversations</span><input type="search" value={query} placeholder="Search conversations" onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        {conversations.error && <div className="queue-notice"><p className="inline-error" role="alert">{conversations.error}</p><button className="button button-outline" onClick={conversations.refresh}>Retry list</button></div>}
        {conversations.loading && <p className="queue-notice" role="status">Loading conversations…</p>}
        <ul className="queue-list">
          {available.map((item) => <li key={item.key}>
            <button className="queue-item" type="button" aria-current={selected?.key === item.key ? 'true' : undefined} disabled={running} onClick={() => setSelectedKey(item.key)}>
              <span className="channel-icon"><Icon name={item.channel === 'voice call' ? 'phone' : 'chat'} size={18} /></span>
              <span className="queue-item-copy"><strong>{item.conversation_id}</strong><span>{item.group_id} · {item.channel === 'voice call' ? 'Call' : 'Chat'}</span></span>
              <span className="queue-language">{item.language}</span>
            </button>
          </li>)}
        </ul>
        {!conversations.loading && !conversations.error && !available.length && <p className="queue-notice">{items.length ? 'No conversations match your search.' : 'No conversations imported yet.'}</p>}
        <div className="queue-footer"><Icon name="folder" size={19} /><div><span>Data source</span><strong>{isMockMode ? 'Synthetic records' : 'Imported records'}</strong></div></div>
      </section>
      <div className="workspace-main">
        {imported && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Group <strong>{imported.group_id}</strong> · {imported.imported} imported, {imported.skipped} skipped</p>}
        {lastSaved && <p className="workspace-status" role="status"><Icon name="check" size={17} /> Saved checklist version <strong>{lastSaved.version_id}</strong></p>}
        {checklists.error && <div className="workspace-alert"><p className="inline-error" role="alert">Could not load checklists. {checklists.error}</p><button className="button button-outline" onClick={checklists.refresh}>Retry checklists</button></div>}
        {selected ? <ConversationDesk key={selected.key} summary={selected} versions={versions} version={version}
          loadingChecklists={checklists.loading} onSelectVersion={setVersionId} onRunningChange={setRunning} />
          : <div className="workspace-empty"><span className="empty-icon"><Icon name="layers" size={25} /></span><h2>{conversations.loading ? 'Loading workspace…' : 'No conversation selected'}</h2><p>{conversations.error ? 'Retry the conversation list to continue.' : 'Import a group or upload a JSON transcript to get started.'}</p></div>}
      </div>
    </main>
  </>
}
