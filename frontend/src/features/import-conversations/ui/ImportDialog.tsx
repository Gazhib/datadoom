import { useState } from 'react'
import type { FormEvent } from 'react'
import { parseUpload, qualityApi } from '../../../entities/quality'
import type { ImportResult } from '../../../entities/quality'
import { isMockMode } from '../../../shared/config/apiMode'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'

function ImportForm({ onImported, onClose }: { onImported: (result: ImportResult) => void; onClose: () => void }) {
  const [source, setSource] = useState<'organizer' | 'upload'>('organizer')
  const [group, setGroup] = useState('')
  const { run, pending, error, clearError } = useMutation()

  function switchSource(next: typeof source) {
    setSource(next)
    setGroup('')
    clearError()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('transcript')
    const groupId = group.trim()
    void run(async () => {
      let result: ImportResult
      if (source === 'upload') {
        if (!(file instanceof File) || !file.name) throw new Error('Choose a JSON transcript file.')
        result = await qualityApi.importConversations({ source, group_id: groupId || 'UPLOAD', records: parseUpload(await file.text()) })
      } else {
        if (!groupId) throw new Error('Enter the organizer group ID.')
        result = await qualityApi.importConversations({ source, group_id: groupId })
      }
      onImported(result)
      onClose()
    })
  }

  return <Dialog title="Import conversations" kicker="Conversation intake" pending={pending} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <legend className="field-label">Import source</legend>
        <div className="choice-row">
          <label><input type="radio" name="source" checked={source === 'organizer'} onChange={() => switchSource('organizer')} /> Organizer group</label>
          <label><input type="radio" name="source" checked={source === 'upload'} onChange={() => switchSource('upload')} /> JSON upload</label>
        </div>
        <label className="field">
          <span className="field-label">Group ID</span>
          <input value={group} onChange={(event) => setGroup(event.target.value)} required={source === 'organizer'} placeholder={source === 'upload' ? 'UPLOAD' : isMockMode ? 'SYNTH' : 'DEV'} />
        </label>
        {source === 'organizer' && isMockMode && <p className="form-note">The synthetic organizer source contains group <code>SYNTH</code>.</p>}
        {source === 'upload' && <label className="field">
          <span className="field-label">Transcript file</span>
          <input name="transcript" type="file" accept=".json,application/json" required />
          <span className="form-note">Choose one record, an array of records, or an organizer export.</span>
        </label>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {pending && <p className="form-note" role="status">Importing conversations…</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={pending}><Icon name="upload" /> {pending ? 'Importing…' : 'Import'}</button>
      </div>
    </form>
  </Dialog>
}

export function ImportDialog({ onImported, disabled }: { onImported: (result: ImportResult) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="button button-outline" type="button" disabled={disabled} onClick={() => setOpen(true)}>
      <Icon name="upload" /> Import conversations
    </button>
    {open && <ImportForm onImported={onImported} onClose={() => setOpen(false)} />}
  </>
}
