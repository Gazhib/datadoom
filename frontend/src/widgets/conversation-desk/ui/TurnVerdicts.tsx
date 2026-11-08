import { useI18n } from '../../../shared/i18n/useI18n'
import { useEffect, useId } from 'react'
import type { CSSProperties } from 'react'
import { gradeLabel, gradeTone } from '../../../entities/quality'
import type { Conversation, Evaluation } from '../../../entities/quality'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import { turnRows } from '../model/judgeVerdicts'
import type { JudgeVerdict, TurnCell, TurnRow } from '../model/judgeVerdicts'
import './turn-verdicts.css'

type Navigate = (turnId: string) => void

function CitedTurns({ ids, turnId, known, onNavigate }: { ids: string[]; turnId: string; known: Set<string>; onNavigate: Navigate }) {
  const { t } = useI18n()
  return <div className="tv-turns">
    <span>{t('citedTurns')}</span>
    {ids.map((id) => id === turnId
      ? <span key={id} className="tv-turn tv-turn-current" aria-current="true">{id}</span>
      : known.has(id)
        ? <button key={id} type="button" className="tv-turn" onClick={() => onNavigate(id)}>{id}</button>
        : <span key={id} className="tv-turn">{id}</span>)}
  </div>
}

function VerdictCell({ cell, row, turnId, known, onNavigate }: { cell: TurnCell; row: TurnRow; turnId: string; known: Set<string>; onNavigate: Navigate }) {
  const { t } = useI18n()
  const { judge, grade, value, cites } = cell
  return <li className={`tv-cell${cites ? ' tv-cell-cites' : ''}${value === undefined ? ' tv-cell-empty' : ''}`}>
    <div className="tv-cell-top">
      <span className="tv-cell-judge">{judge.name}</span>
      {value === undefined
        ? <span className="tv-missing">{judge.status === 'ok' ? t('noVote') : t(judge.status)}</span>
        : <span className={`grade-pill grade-${gradeTone(value, row.criterion)}`}>{gradeLabel(value, row.criterion, t)}</span>}
      {cites && <span className="tv-cites"><Icon name="check" size={13} /> {t('citesThisMessage')}</span>}
    </div>
    {grade
      ? <p className="tv-reason">{grade.reason}</p>
      : value !== undefined && <p className="tv-reason tv-reason-missing">{t('reasonNotSaved')}</p>}
    {grade && <CitedTurns ids={grade.evidence_turn_ids} turnId={turnId} known={known} onNavigate={onNavigate} />}
  </li>
}

function VerdictRow({ row, idPrefix, turnId, known, onNavigate }: { row: TurnRow; idPrefix: string; turnId: string; known: Set<string>; onNavigate: Navigate }) {
  const { t } = useI18n()
  const { criterion, final, vote } = row
  const headingId = `${idPrefix}-${criterion.id}`
  return <section className={`tv-row${row.split ? ' tv-row-split' : ''}`} aria-labelledby={headingId}>
    <header className="tv-row-heading">
      <span className="criterion-id">{criterion.id}</span>
      <h3 id={headingId}>{criterion.label}</h3>
      <div className="tv-row-result">
        {row.split && <span className="tv-split">{t('splitDecision')}</span>}
        {vote && <span className="tv-agreement">{t('judgeAgreement', { percent: Math.round(vote.agreement * 100) })}</span>}
        {final && <span className={`grade-pill grade-${gradeTone(final.value, criterion)}`}>{t('finalGrade', { grade: gradeLabel(final.value, criterion, t) })}</span>}
      </div>
    </header>
    <ul className="tv-cells">
      {row.cells.map((cell) => <VerdictCell key={cell.judge.name} cell={cell} row={row} turnId={turnId} known={known} onNavigate={onNavigate} />)}
    </ul>
  </section>
}

function JudgeHeader({ judges }: { judges: JudgeVerdict[] }) {
  const { t } = useI18n()
  return <ul className="tv-judges" aria-hidden="true">
    {judges.map((judge, index) => <li key={judge.name}>
      <span className="tv-judge-index">{index + 1}</span>
      <span className="tv-judge-copy"><strong>{judge.name}</strong>{judge.model && <span>{judge.model}</span>}</span>
      {judge.status !== 'ok' && <span className={`tv-judge-status judge-${judge.status}`}>{t(judge.status)}</span>}
    </li>)}
  </ul>
}

function useArrowNavigation(previous: string | undefined, next: string | undefined, onNavigate: Navigate) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof Element && event.target.closest('input, select, textarea')
      if (typing || event.altKey || event.ctrlKey || event.metaKey) return
      const destination = event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : undefined
      if (!destination) return
      event.preventDefault()
      onNavigate(destination)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [previous, next, onNavigate])
}

export function TurnVerdicts({ conversation, evaluation, judges, turnId, onNavigate, onClose }: {
  conversation: Conversation
  evaluation: Evaluation
  judges: JudgeVerdict[]
  turnId: string
  onNavigate: Navigate
  onClose: () => void
}) {
  const { t } = useI18n()
  const idPrefix = useId()
  const { turns } = conversation
  const index = turns.findIndex((turn) => turn.id === turnId)
  const turn = turns[index]
  const previous = index > 0 ? turns[index - 1].id : undefined
  const next = index >= 0 ? turns[index + 1]?.id : undefined
  useArrowNavigation(previous, next, onNavigate)
  if (!turn) return null

  const rows = turnRows(turnId, evaluation, judges)
  const splits = rows.filter((row) => row.split).length
  const known = new Set(turns.map(({ id }) => id))
  const actions = <div className="tv-nav">
    <button className="button icon-button tv-prev" type="button" aria-label={t('previousMessage')} disabled={!previous}
      onClick={() => previous && onNavigate(previous)}><Icon name="chevron" size={17} /></button>
    <span className="tv-position">{t('messagePosition', { current: index + 1, total: turns.length })}</span>
    <button className="button icon-button" type="button" aria-label={t('nextMessage')} disabled={!next}
      onClick={() => next && onNavigate(next)}><Icon name="chevron" size={17} /></button>
  </div>

  return <Dialog title={t('messageVerdicts')} kicker={t('messageKicker', { id: turn.id, speaker: t(turn.speaker), time: turn.timestamp })}
    className="turn-verdicts-dialog" actions={actions} pending={false} onClose={onClose}>
    <div className="tv-body" key={turn.id} style={{ '--judges': Math.max(judges.length, 1) } as CSSProperties}>
      <blockquote className={`tv-quote tv-quote-${turn.speaker}`}>
        <p lang={conversation.language === 'KZ' ? 'kk' : conversation.language.toLowerCase()}>{turn.text}</p>
      </blockquote>
      <p className="tv-summary" role="status">
        {t('judgesCount', { count: judges.length })} · {t('messageCriteria', { count: rows.length })}
        {splits > 0 && ` · ${t('splitCriteriaCount', { count: splits })}`}
      </p>
      {rows.length > 0 ? <>
        <JudgeHeader judges={judges} />
        {rows.map((row) => <VerdictRow key={row.criterion.id} row={row} idPrefix={idPrefix} turnId={turn.id} known={known} onNavigate={onNavigate} />)}
      </> : <div className="empty-detail tv-empty">
        <span className="empty-icon"><Icon name="scales" size={22} /></span>
        <h3>{t('noMessageVerdicts')}</h3>
        <p>{t('noMessageVerdictsHelp')}</p>
      </div>}
    </div>
  </Dialog>
}
