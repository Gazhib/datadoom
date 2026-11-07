import { useState } from 'react'
import type { FormEvent } from 'react'
import { allowedGradeValues, gradeLabel, qualityApi } from '../../../entities/quality'
import type { Appeal, Criterion, Decision, Evaluation, Grade, Turn } from '../../../entities/quality'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import './review-criterion.css'

type ReviewProps = {
  evaluationId: string
  criterion: Criterion
  original: Grade
  turns: Turn[]
  appeal?: Appeal
  onUpdated: (evaluation: Evaluation) => void
}

function ReviewForm({ evaluationId, criterion, original, turns, appeal, onUpdated, onClose }: ReviewProps & { onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [action, setAction] = useState<Decision['action']>('confirm')
  const [value, setValue] = useState(original.value)
  const [rationale, setRationale] = useState('')
  const [evidence, setEvidence] = useState(original.evidence_turn_ids)
  const { run, pending, error } = useMutation()
  const changing = appeal && action === 'change'
  const grades = allowedGradeValues(criterion)

  function toggleTurn(id: string, checked: boolean) {
    setEvidence((previous) => checked ? [...previous, id] : previous.filter((item) => item !== id))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      const note = reason.trim()
      if (!note) throw new Error(appeal ? 'Enter a decision reason.' : 'Enter an appeal comment.')
      const decision: Decision = { action, reason: note }
      if (changing) {
        const evidenceIds = turns.filter(({ id }) => evidence.includes(id)).map(({ id }) => id)
        if (!rationale.trim() || !evidenceIds.length) {
          throw new Error('Enter a replacement rationale and select at least one evidence turn.')
        }
        decision.replacement = {
          criterion_id: criterion.id, value, reason: rationale.trim(), evidence_turn_ids: evidenceIds,
        }
      }
      const updated = appeal
        ? await qualityApi.decideAppeal(evaluationId, criterion.id, decision)
        : await qualityApi.submitAppeal(evaluationId, criterion.id, note)
      onUpdated(updated)
      onClose()
    })
  }

  return <Dialog title={appeal ? 'Resolve appeal' : 'Appeal grade'} kicker={`Criterion ${criterion.id}`} wide pending={pending} onClose={onClose}>
    <div className="review-context">
      <h3>{criterion.label}</h3>
      <p><strong>Original grade {gradeLabel(original.value, criterion)}</strong></p>
      <p>{original.reason}</p>
      <details>
        <summary>Original evidence</summary>
        <ul className="review-evidence">
          {turns.filter(({ id }) => original.evidence_turn_ids.includes(id)).map((turn) => <li key={turn.id}>
            <strong>{turn.id} · {turn.timestamp} · {turn.speaker}</strong>
            <span>{turn.text}</span>
          </li>)}
        </ul>
      </details>
      {appeal && <p className="review-note"><strong>Appeal comment</strong> {appeal.comment}</p>}
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        {appeal && <fieldset>
          <legend className="field-label">Decision</legend>
          <div className="choice-row">
            <label><input type="radio" name="action" checked={action === 'confirm'} onChange={() => setAction('confirm')} /> Confirm grade</label>
            <label><input type="radio" name="action" checked={action === 'change'} onChange={() => setAction('change')} /> Change grade</label>
          </div>
        </fieldset>}
        <label className="field"><span className="field-label">{appeal ? 'Decision reason' : 'Appeal comment'}</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required />
        </label>
        {changing && <>
          <label className="field"><span className="field-label">Replacement grade</span>
            <select value={String(value)} onChange={(event) => setValue(grades.find((grade) => String(grade) === event.target.value)!)}>
              {grades.map((grade) => <option value={grade} key={grade}>{gradeLabel(grade, criterion)}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Replacement rationale</span>
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} required />
          </label>
          <fieldset>
            <legend className="field-label">Evidence turns</legend>
            <div className="review-evidence">
              {turns.map((turn) => <label className="checkbox-field" key={turn.id}>
                <input type="checkbox" checked={evidence.includes(turn.id)} onChange={(event) => toggleTurn(turn.id, event.target.checked)} />
                <span><strong>{turn.id} · {turn.timestamp} · {turn.speaker}</strong><span>{turn.text}</span></span>
              </label>)}
            </div>
          </fieldset>
        </>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : appeal ? 'Save decision' : 'Submit appeal'}
        </button>
      </div>
    </form>
  </Dialog>
}

export function ReviewCriterion({ disabled, compact = false, ...props }: ReviewProps & { disabled: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const { appeal } = props
  const decision = appeal?.decision

  return <div className={compact ? 'criterion-review review-compact' : 'criterion-review'}>
    {appeal && !compact && <div className="review-trail">
      <p role="status" className="review-status">
        {appeal.status === 'open' ? 'Appeal open' : decision?.action === 'change' ? 'Grade changed' : 'Grade confirmed'}
      </p>
      <p className="review-note"><strong>Appeal comment</strong> {appeal.comment}</p>
      {decision && <p className="review-note"><strong>Decision reason</strong> {decision.reason}</p>}
    </div>}
    {compact && appeal?.status === 'resolved' && <span className="review-status">{decision?.action === 'change' ? 'Grade changed' : 'Grade confirmed'}</span>}
    {appeal?.status !== 'resolved' && <button className={compact ? 'button button-outline' : 'button button-outline review-button'} type="button" disabled={disabled} onClick={() => setOpen(true)}>
      {appeal ? 'Resolve appeal' : 'Appeal grade'}
    </button>}
    {open && <ReviewForm {...props} onClose={() => setOpen(false)} />}
  </div>
}
