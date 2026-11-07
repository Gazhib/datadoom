import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isMockMode, parseUpload, qualityApi } from '../../../entities/quality'
import type { ImportResult } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import { errorMessage } from '../model/useRemote'

export function ImportDialog({ onImported, disabled }: { onImported: (result: ImportResult) => void; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [source, setSource] = useState<'organizer' | 'upload'>('organizer')
  const [group, setGroup] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function switchSource(next: typeof source) {
    setSource(next)
    setGroup('')
    setFile(null)
    setError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      let result: ImportResult
      if (source === 'upload') {
        if (!file) throw new Error('Choose a JSON transcript file.')
        result = await qualityApi.importConversations({ source, group_id: group.trim() || 'UPLOAD', records: parseUpload(await file.text()) })
      } else {
        if (!group.trim()) throw new Error('Enter the organizer group ID.')
        result = await qualityApi.importConversations({ source, group_id: group.trim() })
      }
      dialog.current?.close()
      onImported(result)
      if (fileInput.current) fileInput.current.value = ''
      switchSource(source)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return <>
    <button className="button button-primary" type="button" disabled={disabled} onClick={() => dialog.current?.showModal()}>
      <Icon name="upload" /> Import conversations
    </button>
    <dialog ref={dialog} className="import-dialog" aria-labelledby="import-title" onCancel={(event) => { if (busy.current) event.preventDefault() }}>
      <div className="dialog-heading">
        <div><p className="kicker">Conversation intake</p><h2 id="import-title">Import conversations</h2></div>
        <button className="button icon-button" type="button" aria-label="Close import" disabled={pending} onClick={() => dialog.current?.close()}><Icon name="close" /></button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          <legend className="field-label">Import source</legend>
          <div className="source-picker">
            <label><input type="radio" name="source" checked={source === 'organizer'} onChange={() => switchSource('organizer')} /> Organizer group</label>
            <label><input type="radio" name="source" checked={source === 'upload'} onChange={() => switchSource('upload')} /> JSON upload</label>
          </div>
          <label className="field">
            <span className="field-label">Group ID</span>
            <input autoFocus value={group} onChange={(event) => setGroup(event.target.value)} required={source === 'organizer'} placeholder={source === 'upload' ? 'UPLOAD' : isMockMode ? 'SYNTH' : 'DEV'} />
          </label>
          {source === 'organizer' && isMockMode && <p className="form-note">The synthetic organizer source contains group <code>SYNTH</code>.</p>}
          {source === 'upload' && <label className="field">
            <span className="field-label">Transcript file</span>
            <input ref={fileInput} type="file" accept=".json,application/json" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span className="form-note">Choose one record, an array of records, or an organizer export.</span>
          </label>}
        </fieldset>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {pending && <p className="form-note" role="status">Importing conversations…</p>}
        <div className="dialog-actions">
          <button className="button button-outline" type="button" disabled={pending} onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={pending}><Icon name="upload" /> {pending ? 'Importing…' : 'Import'}</button>
        </div>
      </form>
    </dialog>
  </>
}
