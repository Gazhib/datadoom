import { useState } from 'react'
import type { FormEvent } from 'react'
import { qualityApi, validateCriterion } from '../../../entities/quality'
import type { Checklist, Criterion } from '../../../entities/quality'
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
      if (!name.trim()) throw new Error('Enter a checklist name.')
      const criteria = drafts.map(normalizeCriterion)
      const seen = new Set<string>()
      for (const [index, criterion] of criteria.entries()) {
        const issue = validateCriterion(criterion) ?? (seen.has(criterion.id) ? 'Criterion IDs must be unique.' : null)
        if (issue) {
          setSelected(index)
          throw new Error(`Criterion ${index + 1}. ${issue}`)
        }
        seen.add(criterion.id)
      }
      if (!criteria.some(({ kind }) => kind !== 'flag')) throw new Error('Keep at least one weighted criterion.')
      onSaved(await qualityApi.createChecklist({ name: name.trim(), criteria }))
      onClose()
    })
  }

  return <Dialog title="Edit checklist" kicker="Checklist versions" wide pending={pending} onClose={onClose}>
    <p className="form-note editor-note">Editing {source.version_id}. Saving creates a new version.</p>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <label className="field"><span className="field-label">Checklist name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <div className="editor-toolbar">
          <label className="field"><span className="field-label">Criterion to edit</span>
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              {drafts.map((criterion, index) => <option key={index} value={index}>
                {criterion.id || `Criterion ${index + 1}`} · {criterion.label || 'Untitled'}
              </option>)}
            </select>
          </label>
          <button className="button button-outline" type="button" onClick={addCriterion}>Add criterion</button>
        </div>
        <div className="editor-criterion" key={selected}>
          <div className="editor-fields editor-identity">
            <label className="field"><span className="field-label">Criterion ID</span>
              <input value={current.id} onChange={(event) => update({ id: event.target.value })} required />
            </label>
            <label className="field"><span className="field-label">Criterion label</span>
              <input value={current.label} onChange={(event) => update({ label: event.target.value })} required />
            </label>
          </div>
          <label className="field"><span className="field-label">Scoring instruction</span>
            <textarea value={current.instruction} onChange={(event) => update({ instruction: event.target.value })} rows={3} required />
            {current.kind === 'scale' && <span className="form-note">Describe what each scale step means.</span>}
          </label>
          <div className="editor-fields">
            <label className="field"><span className="field-label">Answer type</span>
              <select value={current.kind} onChange={(event) => update({ kind: event.target.value as Criterion['kind'] })}>
                <option value="binary">Yes / No</option>
                <option value="scale">Scale</option>
                <option value="flag">Serious error flag</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Weight</span>
              <input type="number" min={1} max={100} value={current.kind === 'flag' ? '0' : current.weight}
                disabled={current.kind === 'flag'} onChange={(event) => update({ weight: event.target.value })} required />
            </label>
          </div>
          {current.kind === 'scale' && <label className="field"><span className="field-label">Scale steps</span>
            <input value={current.scale} onChange={(event) => update({ scale: event.target.value })} placeholder="0, 5, 10" required />
            <span className="form-note">Use comma-separated whole numbers, starting at 0.</span>
          </label>}
          <label className="field"><span className="field-label">Section (optional)</span>
            <input value={current.section ?? ''} onChange={(event) => update({ section: event.target.value })} />
          </label>
          {current.kind !== 'flag' && <>
            <label className="checkbox-field"><input type="checkbox" checked={current.allow_na} onChange={(event) => update({ allow_na: event.target.checked })} /> Allow N/A</label>
            {current.allow_na && <label className="field"><span className="field-label">N/A rule</span>
              <textarea value={current.na_rule ?? ''} onChange={(event) => update({ na_rule: event.target.value })} rows={2} required />
            </label>}
          </>}
          <button className="button button-outline" type="button" disabled={drafts.length === 1} onClick={removeCriterion}>Remove criterion</button>
        </div>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save new version'}</button>
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
  const [editing, setEditing] = useState(false)
  return <>
    <button className={navigation ? 'nav-button' : 'button button-outline'} type="button" aria-haspopup="dialog" disabled={disabled || !checklist} onClick={() => setEditing(true)}>
      <Icon name="checklist" size={17} /><span>{navigation ? 'Checklists' : 'Edit checklist'}</span>
    </button>
    {editing && checklist && <ChecklistEditor source={checklist} onClose={() => setEditing(false)} onSaved={onSaved} />}
  </>
}
