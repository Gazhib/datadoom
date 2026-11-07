import { useState } from 'react'
import { isMockMode, qualityApi } from '../../../entities/quality'
import type { ImportResult } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import { useRemote } from '../model/useRemote'
import { ConversationDesk } from './ConversationDesk'
import { ImportDialog } from './ImportDialog'

export function QualityWorkspace() {
  const conversations = useRemote(qualityApi.listConversations)
  const checklists = useRemote(qualityApi.listChecklists)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [running, setRunning] = useState(false)

  const items = conversations.data?.items ?? []
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

  return <>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="app-header">
      <div className="header-inner">
        <div className="brand"><span className="brand-mark"><Icon name="activity" size={22} /></span><span>Datadoom<span className="brand-period">.</span></span></div>
        <span className="header-context">Conversation quality analytics</span>
        <span className={`mode-badge ${isMockMode ? 'mode-synthetic' : 'mode-live'}`}><span className="mode-dot" />{isMockMode ? 'Synthetic mode' : 'Live API'}</span>
      </div>
    </header>
    <main className="workspace" id="main" tabIndex={-1}>
      <div className="intro">
        <div><p className="kicker workspace-kicker"><span /> Analyst workspace</p><h1>Conversation review</h1><p className="intro-copy">Run a checklist on a conversation and trace each grade to the source.</p></div>
        <ImportDialog onImported={handleImport} disabled={running} />
      </div>
      {imported && <p className="import-status" role="status"><Icon name="check" size={17} /> Group <strong>{imported.group_id}</strong> · {imported.imported} imported, {imported.skipped} skipped</p>}
      {checklists.error && <div className="workspace-alert"><p className="inline-error" role="alert">Could not load checklists. {checklists.error}</p><button className="button button-outline" onClick={checklists.refresh}>Retry checklists</button></div>}
      <div className="workbench">
        <section className="queue" aria-labelledby="queue-heading">
          <div className="queue-header">
            <div className="queue-heading"><h2 id="queue-heading">Conversations</h2><span className="count-chip">{items.length}</span></div>
            <label className="search"><Icon name="search" size={17} /><span className="sr-only">Search conversations</span><input type="search" value={query} placeholder="Find a conversation" onChange={(event) => setQuery(event.target.value)} /></label>
          </div>
          {conversations.error && <div className="queue-notice"><p className="inline-error" role="alert">{conversations.error}</p><button className="button button-outline" onClick={conversations.refresh}>Retry list</button></div>}
          {conversations.loading && <p className="queue-notice form-note" role="status">Loading conversations…</p>}
          <ul className="queue-list">
            {available.map((item) => <li key={item.key}>
              <button className="queue-item" type="button" aria-current={selected?.key === item.key ? 'true' : undefined} disabled={running} onClick={() => setSelectedKey(item.key)}>
                <span className="channel-icon"><Icon name={item.channel === 'voice call' ? 'phone' : 'chat'} size={17} /></span>
                <span className="queue-item-copy"><strong>{item.conversation_id}</strong><span>{item.channel} · {item.language}</span><span className="queue-group">{item.group_id}</span></span>
                <Icon name="chevron" size={15} />
              </button>
            </li>)}
          </ul>
          {!conversations.loading && !conversations.error && !available.length && <p className="queue-notice form-note">{items.length ? 'No conversations match your search.' : 'No conversations imported yet.'}</p>}
          <div className="queue-footer"><Icon name="folder" size={16} /><span>{isMockMode ? 'Synthetic records' : 'Imported records'}</span></div>
        </section>
        {selected ? <ConversationDesk key={selected.key} summary={selected} checklists={checklists.data?.items ?? []} loadingChecklists={checklists.loading} onRunningChange={setRunning} />
          : <div className="workspace-empty"><span className="empty-icon"><Icon name="layers" size={25} /></span><h2>{conversations.loading ? 'Loading workspace…' : 'No conversation selected'}</h2><p>{conversations.error ? 'Retry the conversation list to continue.' : 'Import a group or upload a JSON transcript to get started.'}</p></div>}
      </div>
    </main>
  </>
}
