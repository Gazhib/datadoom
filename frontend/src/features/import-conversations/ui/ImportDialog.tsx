import { useI18n } from '../../../shared/i18n/useI18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { parseUpload, qualityApi } from '../../../entities/quality'
import type { ImportResult } from '../../../entities/quality'
import { isMockMode } from '../../../shared/config/apiMode'
import { UiError } from '../../../shared/i18n/messages'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'

function ImportForm({ onImported, onClose }: { onImported: (result: ImportResult) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [source, setSource] = useState<'organizer' | 'upload'>('organizer')
  const [group, setGroup] = useState('')
  const [fileName, setFileName] = useState('')
  const { run, pending, error, clearError } = useMutation()

  function switchSource(next: typeof source) {
    setSource(next)
    setGroup('')
    setFileName('')
    clearError()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('transcript')
    const groupId = group.trim()
    void run(async () => {
      let result: ImportResult
      if (source === 'upload') {
        if (!(file instanceof File) || !file.name) throw new UiError('chooseJsonFile')
        result = await qualityApi.importConversations({ source, group_id: groupId || 'UPLOAD', records: parseUpload(await file.text()) })
      } else {
        if (!groupId) throw new UiError('enterOrganizerGroup')
        result = await qualityApi.importConversations({ source, group_id: groupId })
      }
      onImported(result)
      onClose()
    })
  }

  return <Dialog title={t('importConversations')} kicker={t('conversationIntake')} pending={pending} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <legend className="field-label">{t('importSource')}</legend>
        <div className="choice-row">
          <label><input type="radio" name="source" checked={source === 'organizer'} onChange={() => switchSource('organizer')} /> {t('organizerGroup')}</label>
          <label><input type="radio" name="source" checked={source === 'upload'} onChange={() => switchSource('upload')} /> {t('jsonUpload')}</label>
        </div>
        <label className="field">
          <span className="field-label">{t('groupId')}</span>
          <input value={group} onChange={(event) => setGroup(event.target.value)} required={source === 'organizer'} placeholder={source === 'upload' ? 'UPLOAD' : isMockMode ? 'SYNTH' : 'DEV'} />
        </label>
        {source === 'organizer' && isMockMode && <p className="form-note">{t('demoImportHelp', { group: 'SYNTH' })}</p>}
        {source === 'upload' && <label className="field">
          <span className="field-label">{t('transcriptFile')}</span>
          <span className="file-picker">
            <input className="sr-only" name="transcript" type="file" accept=".json,application/json"
              aria-label={t('transcriptFile')} onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? '')} />
            <span className="button button-outline" aria-hidden="true">{t('chooseFile')}</span>
            <span className="form-note" aria-hidden="true">{fileName || t('noFileChosen')}</span>
          </span>
          <span className="form-note">{t('uploadHelp')}</span>
        </label>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {pending && <p className="form-note" role="status">{t('importingConversations')}</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button>
        <button className="button button-primary" type="submit" disabled={pending}><Icon name="upload" /> {pending ? t('importing') : t('import')}</button>
      </div>
    </form>
  </Dialog>
}

export function ImportDialog({ onImported, disabled }: { onImported: (result: ImportResult) => void; disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return <>
    <button className="button button-outline" type="button" aria-label={t('importConversations')} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}>
      <Icon name="upload" size={17} /> {t('import')}
    </button>
    {open && <ImportForm onImported={onImported} onClose={() => setOpen(false)} />}
  </>
}
