import { useI18n } from '../../../shared/i18n/useI18n'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import gsap from 'gsap'
import type { Conversation } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import type { TurnMark } from '../model/judgeVerdicts'

export type EvidenceTarget = { id: string; criterionId: string; original?: boolean; source?: string; origin: HTMLButtonElement }

function focusEvidence(element: HTMLElement) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.focus({ preventScroll: true })
  element.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' })
  return reduceMotion
}

function findTurn(list: HTMLOListElement | null, id: string) {
  const turn = Array.from(list?.children ?? []).find((item) => item.getAttribute('data-turn') === id)
  return turn instanceof HTMLElement ? turn : null
}

export function Transcript({ conversation, target, marks, activeId, onOpen }: {
  conversation: Conversation
  target: EvidenceTarget | null
  // Per-turn judge markers; when present, clicking a turn opens its verdicts.
  marks?: ReadonlyMap<string, TurnMark[]>
  activeId?: string | null
  onOpen?: (turnId: string) => void
}) {
  const { t } = useI18n()
  const transcript = useRef<HTMLOListElement>(null)
  const interactive = !!marks && !!onOpen

  useLayoutEffect(() => {
    const turn = target && findTurn(transcript.current, target.id)
    if (!turn || focusEvidence(turn)) return
    const context = gsap.context(() => {
      gsap.fromTo('.turn-indicator', { scaleY: 0.25, opacity: 0.4 }, { scaleY: 1, opacity: 1, duration: 0.32, ease: 'power2.out' })
    }, turn)
    return () => context.revert()
  }, [target])

  // Keep the turn shown in the verdict popup visible behind it.
  useEffect(() => {
    if (activeId) findTurn(transcript.current, activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function openFromTurn(event: MouseEvent<HTMLLIElement>, id: string) {
    const clickedControl = event.target instanceof Element && event.target.closest('button, a')
    if (!onOpen || clickedControl || window.getSelection()?.toString()) return
    onOpen(id)
  }

  return <section className="transcript pane" aria-labelledby="transcript-heading">
    <header className="pane-heading">
      <h2 id="transcript-heading" tabIndex={-1}>{t('transcript')}</h2>
      <div className="transcript-meta">
        {interactive && <span className="transcript-hint"><Icon name="scales" size={14} /> {t('clickMessageHint')}</span>}
        <span className="quiet-chip">{t('turnCount', { count: conversation.turns.length })}</span>
      </div>
    </header>
    <ol className={`turns${interactive ? ' turns-interactive' : ''}`} ref={transcript}>
      {conversation.turns.map((turn) => {
        const turnMarks = marks?.get(turn.id) ?? []
        const cited = turnMarks.reduce((total, mark) => Math.max(total, mark.count), 0)
        const classes = ['turn', `turn-${turn.speaker}`, target?.id === turn.id && 'turn-highlighted', activeId === turn.id && 'turn-active']
        return <li className={classes.filter(Boolean).join(' ')} key={turn.id} data-turn={turn.id} tabIndex={-1}
          onClick={interactive ? (event) => openFromTurn(event, turn.id) : undefined}>
          <span className="turn-indicator" aria-hidden="true" />
          <span className="turn-id">{turn.id}</span>
          <div className="turn-copy">
            <div className="turn-meta"><strong>{t(turn.speaker)}</strong><time>{turn.timestamp}</time></div>
            <p lang={conversation.language === 'KZ' ? 'kk' : conversation.language.toLowerCase()}>{turn.text}</p>
            {target?.id === turn.id && <button className="evidence-return" type="button" onClick={() => focusEvidence(target.origin)}><Icon name="arrow" size={15} /> {t('backToCriterion', { id: target.criterionId })}</button>}
          </div>
          {interactive && <button type="button" className={`turn-verdicts${cited ? '' : ' turn-verdicts-quiet'}`} aria-haspopup="dialog"
            aria-label={t('openMessageVerdicts', { id: turn.id, criteria: t('criteriaCount', { count: cited }) })} onClick={() => onOpen?.(turn.id)}>
            {turnMarks.map((mark, index) => <span key={mark.judge} className={`turn-mark turn-mark-${mark.tone ?? 'none'}`}
              title={`${mark.judge}: ${t('criteriaCount', { count: mark.count })}`} aria-hidden="true">{index + 1}</span>)}
          </button>}
        </li>
      })}
    </ol>
    <div className="transcript-footer"><Icon name="shield" size={14} /> {t('originalTranscript')}</div>
  </section>
}
