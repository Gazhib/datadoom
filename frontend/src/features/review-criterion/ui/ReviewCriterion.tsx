import { useI18n } from '../../../shared/i18n/useI18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { allowedGradeValues, CriterionVotes, gradeLabel, qualityApi } from '../../../entities/quality'
import type { Appeal, Criterion, Decision, Evaluation, Grade, PanelVote, Turn } from '../../../entities/quality'
import { UiError } from '../../../shared/i18n/messages'
import { useMutation } from '../../../shared/lib/useMutation'
import { Dialog } from '../../../shared/ui/Dialog'
import './review-criterion.css'

type ReviewProps = {
  evaluationId: string
  criterion: Criterion
  original: Grade
  turns: Turn[]
  appeal?: Appeal
  vote?: PanelVote
  onUpdated: (evaluation: Evaluation) => void
}

function ReviewForm({ evaluationId, criterion, original, turns, appeal, vote, onUpdated, onClose }: ReviewProps & { onClose: () => void }) {
  const { t } = useI18n()
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
      if (!note) throw new UiError(appeal ? 'enterDecisionReason' : 'enterAppealComment')
      const decision: Decision = { action, reason: note }
      if (changing) {
        const evidenceIds = turns.filter(({ id }) => evidence.includes(id)).map(({ id }) => id)
        if (!rationale.trim() || !evidenceIds.length) {
          throw new UiError('replacementEvidenceRequired')
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

  return <Dialog title={appeal ? t('resolveAppeal') : t('appealGrade')} kicker={t('criterionName', { id: criterion.id })} wide pending={pending} onClose={onClose}>
    <div className="review-context">
      <h3>{criterion.label}</h3>
      <p><strong>{t('originalGrade', { grade: gradeLabel(original.value, criterion, t) })}</strong></p>
      <p>{original.reason}</p>
      <CriterionVotes criterion={criterion} vote={vote} />
      <details>
        <summary>{t('originalEvidence')}</summary>
        <ul className="review-evidence">
          {turns.filter(({ id }) => original.evidence_turn_ids.includes(id)).map((turn) => <li key={turn.id}>
            <strong>{turn.id} · {turn.timestamp} · {t(turn.speaker)}</strong>
            <span>{turn.text}</span>
          </li>)}
        </ul>
      </details>
      {appeal && <p className="review-note"><strong>{t('appealComment')}</strong> {appeal.comment}</p>}
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        {appeal && <fieldset>
          <legend className="field-label">{t('decision')}</legend>
          <div className="choice-row">
            <label><input type="radio" name="action" checked={action === 'confirm'} onChange={() => setAction('confirm')} /> {t('confirmGrade')}</label>
            <label><input type="radio" name="action" checked={action === 'change'} onChange={() => setAction('change')} /> {t('changeGrade')}</label>
          </div>
        </fieldset>}
        <label className="field"><span className="field-label">{appeal ? t('decisionReason') : t('appealComment')}</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required />
        </label>
        {changing && <>
          <label className="field"><span className="field-label">{t('replacementGrade')}</span>
            <select value={String(value)} onChange={(event) => setValue(grades.find((grade) => String(grade) === event.target.value)!)}>
              {grades.map((grade) => <option value={grade} key={grade}>{gradeLabel(grade, criterion, t)}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">{t('replacementRationale')}</span>
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} required />
          </label>
          <fieldset>
            <legend className="field-label">{t('evidenceTurns')}</legend>
            <div className="review-evidence">
              {turns.map((turn) => <label className="checkbox-field" key={turn.id}>
                <input type="checkbox" checked={evidence.includes(turn.id)} onChange={(event) => toggleTurn(turn.id, event.target.checked)} />
                <span><strong>{turn.id} · {turn.timestamp} · {t(turn.speaker)}</strong><span>{turn.text}</span></span>
              </label>)}
            </div>
          </fieldset>
        </>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button button-outline" type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? t('saving') : appeal ? t('saveDecision') : t('submitAppeal')}
        </button>
      </div>
    </form>
  </Dialog>
}

export function ReviewCriterion({ disabled, compact = false, ...props }: ReviewProps & { disabled: boolean; compact?: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { appeal } = props
  const decision = appeal?.decision

  return <div className={compact ? 'criterion-review review-compact' : 'criterion-review'}>
    {appeal && !compact && <div className="review-trail">
      <p role="status" className="review-status">
        {appeal.status === 'open' ? t('appealOpen') : decision?.action === 'change' ? t('gradeChanged') : t('gradeConfirmed')}
      </p>
      <p className="review-note"><strong>{t('appealComment')}</strong> {appeal.comment}</p>
      {decision && <p className="review-note"><strong>{t('decisionReason')}</strong> {decision.reason}</p>}
    </div>}
    {compact && appeal?.status === 'resolved' && <span className="review-status">{decision?.action === 'change' ? t('gradeChanged') : t('gradeConfirmed')}</span>}
    {appeal?.status !== 'resolved' && <button className={compact ? 'button button-outline' : 'button button-outline review-button'} type="button" disabled={disabled} onClick={() => setOpen(true)}>
      {appeal ? t('resolveAppeal') : t('appealGrade')}
    </button>}
    {open && <ReviewForm {...props} onClose={() => setOpen(false)} />}
  </div>
}
