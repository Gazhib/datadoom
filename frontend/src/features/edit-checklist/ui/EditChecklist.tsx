import { useI18n } from '../../../shared/i18n/useI18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { qualityApi, validateCriterion } from '../../../entities/quality'
import type { Checklist, Criterion } from '../../../entities/quality'
import { UiError } from '../../../shared/i18n/messages'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import './edit-checklist.css'

type DraftCriterion = Omit<Criterion, 'weight' | 'scale'> & { weight: string; scale: string }

function normalizeCriterion(draft: DraftCriterion): Criterion {
  const flag = draft.kind === 'flag'
  const allow_na = !flag && draft.allow_na
  return {
    ...draft,
    id: draft.id.trim(),
    label: draft.label.trim(),
    instruction: draft.instruction.trim(),
    weight: flag ? 0 : Number(draft.weight),
    scale: draft.kind === 'scale' ? draft.scale.split(',').map((step) => /^\d+$/.test(step.trim()) ? Number(step) : NaN) : [],
    allow_na,
    na_rule: allow_na ? draft.na_rule?.trim() ?? '' : null,
    section: draft.section?.trim() || null,
  }
}

function ChecklistEditor({ source, onClose, onSaved }: {
  source: Checklist
  onClose: () => void
  onSaved: (checklist: Checklist) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(source.name)
  const [drafts, setDrafts] = useState<DraftCriterion[]>(() => source.criteria.map((criterion) => ({
    ...criterion, weight: String(criterion.weight || 10), scale: criterion.scale.join(', '),
  })))
  const [selected, setSelected] = useState(0)
  const { run, pending, error } = useMutation()
  const current = drafts[selected]

  function update(patch: Partial<DraftCriterion>) {
    setDrafts((items) => items.map((item, index) => index === selected ? { ...item, ...patch } : item))
  }

  function addCriterion() {
    let next = drafts.length + 1
    const makeId = () => `C${String(next).padStart(2, '0')}`
    while (drafts.some(({ id }) => id.trim() === makeId())) next++
    setDrafts([...drafts, {
      id: makeId(), label: '', instruction: '', kind: 'binary', weight: '10', scale: '',
      allow_na: false, na_rule: null, section: null,
    }])
    setSelected(drafts.length)
  }

  function removeCriterion() {
    setDrafts(drafts.filter((_, index) => index !== selected))
    setSelected(Math.max(0, selected - 1))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      if (!name.trim()) throw new UiError('enterChecklistName')
      const criteria = drafts.map(normalizeCriterion)
      const seen = new Set<string>()
      for (const [index, criterion] of criteria.entries()) {
        const issue = validateCriterion(criterion) ?? (seen.has(criterion.id) ? 'uniqueCriterionIds' : null)
        if (issue) {
          setSelected(index)
          throw new Error(t('criterionIssue', { index: index + 1, issue: t(issue) }))
        }
        seen.add(criterion.id)
      }
      if (!criteria.some(({ kind }) => kind !== 'flag')) throw new UiError('weightedCriterionRequired')
      onSaved(await qualityApi.createChecklist({ name: name.trim(), criteria }))
      onClose()
    })
  }

  return <Dialog title={t('editChecklist')} kicker={t('checklistVersions')} wide pending={pending} onClose={onClose}>
    <p className="form-note editor-note">{t('editChecklistNote', { version: source.version_id })}</p>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <label className="field"><span className="field-label">{t('checklistName')}</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <div className="editor-toolbar">
          <label className="field"><span className="field-label">{t('criterionToEdit')}</span>
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              {drafts.map((criterion, index) => <option key={index} value={index}>
                {criterion.id || t('criterionName', { id: index + 1 })} · {criterion.label || t('untitled')}
              </option>)}
            </select>
          </label>
          <button className="button button-outline" type="button" onClick={addCriterion}>{t('addCriterion')}</button>
        </div>
        <div className="editor-criterion" key={selected}>
          <div className="editor-fields editor-identity">
            <label className="field"><span className="field-label">{t('criterionId')}</span>
              <input value={current.id} onChange={(event) => update({ id: event.target.value })} required />
            </label>
            <label className="field"><span className="field-label">{t('criterionLabel')}</span>
              <input value={current.label} onChange={(event) => update({ label: event.target.value })} required />
            </label>
          </div>
          <label className="field"><span className="field-label">{t('scoringInstruction')}</span>
            <textarea value={current.instruction} onChange={(event) => update({ instruction: event.target.value })} rows={3} required />
            {current.kind === 'scale' && <span className="form-note">{t('scaleDescription')}</span>}
          </label>
          <div className="editor-fields">
            <label className="field"><span className="field-label">{t('answerType')}</span>
              <select value={current.kind} onChange={(event) => update({ kind: event.target.value as Criterion['kind'] })}>
                <option value="binary">{t('binary')}</option>
                <option value="scale">{t('scale')}</option>
                <option value="flag">{t('flag')}</option>
              </select>
            </label>
            <label className="field"><span className="field-label">{t('weight')}</span>
              <input type="number" min={1} max={100} value={current.kind === 'flag' ? '0' : current.weight}
                disabled={current.kind === 'flag'} onChange={(event) => update({ weight: event.target.value })} required />
            </label>
          </div>
          {current.kind === 'scale' && <label className="field"><span className="field-label">{t('scaleSteps')}</span>
            <input value={current.scale} onChange={(event) => update({ scale: event.target.value })} placeholder="0, 5, 10" required />
            <span className="form-note">{t('scaleHelp')}</span>
          </label>}
          <label className="field"><span className="field-label">{t('sectionOptional')}</span>
            <input value={current.section ?? ''} onChange={(event) => update({ section: event.target.value })} />
          </label>
          {current.kind !== 'flag' && <>
            <label className="checkbox-field"><input type="checkbox" checked={current.allow_na} onChange={(event) => update({ allow_na: event.target.checked })} /> {t('allowNa')}</label>
            {current.allow_na && <label className="field"><span className="field-label">{t('naRule')}</span>
              <textarea value={current.na_rule ?? ''} onChange={(event) => update({ na_rule: event.target.value })} rows={2} required />
            </label>}
          </>}
          <button className="button button-outline" type="button" disabled={drafts.length === 1} onClick={removeCriterion}>{t('removeCriterion')}</button>
        </div>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t('saving') : t('saveVersion')}</button>
      </div>
    </form>
  </Dialog>
}

export function EditChecklist({ checklist, disabled, onSaved, navigation = false }: {
  checklist?: Checklist
  disabled: boolean
  onSaved: (checklist: Checklist) => void
  navigation?: boolean
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  return <>
    <button className={navigation ? 'nav-button' : 'button button-outline'} type="button" aria-haspopup="dialog" disabled={disabled || !checklist} onClick={() => setEditing(true)}>
      <Icon name="checklist" size={17} /><span>{navigation ? t('checklists') : t('editChecklist')}</span>
    </button>
    {editing && checklist && <ChecklistEditor source={checklist} onClose={() => setEditing(false)} onSaved={onSaved} />}
  </>
}
