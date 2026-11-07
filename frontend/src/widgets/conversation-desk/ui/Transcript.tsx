import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import type { Conversation } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'

export type EvidenceTarget = { id: string; criterionId: string; original?: boolean; source?: string; origin: HTMLButtonElement }

function focusEvidence(element: HTMLElement) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.focus({ preventScroll: true })
  element.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' })
  return reduceMotion
}

export function Transcript({ conversation, target }: { conversation: Conversation; target: EvidenceTarget | null }) {
  const transcript = useRef<HTMLOListElement>(null)

  useLayoutEffect(() => {
    if (!target || !transcript.current) return
    const turn = Array.from(transcript.current.children).find((item) => item.getAttribute('data-turn') === target.id)
    if (!(turn instanceof HTMLElement)) return

    if (focusEvidence(turn)) return

    const context = gsap.context(() => {
      gsap.fromTo('.turn-indicator', { scaleY: 0.25, opacity: 0.4 }, { scaleY: 1, opacity: 1, duration: 0.32, ease: 'power2.out' })
    }, turn)
    return () => context.revert()
  }, [target])

  return <section className="transcript pane" aria-labelledby="transcript-heading">
    <header className="pane-heading">
      <h2 id="transcript-heading" tabIndex={-1}>Transcript</h2>
      <span className="quiet-chip">{String(conversation.turns.length).padStart(2, '0')} {conversation.turns.length === 1 ? 'turn' : 'turns'}</span>
    </header>
    <ol className="turns" ref={transcript}>
      {conversation.turns.map((turn) => <li className={`turn turn-${turn.speaker}${target?.id === turn.id ? ' turn-highlighted' : ''}`} key={turn.id} data-turn={turn.id} tabIndex={-1}>
        <span className="turn-indicator" aria-hidden="true" />
        <div className="turn-copy">
          <div className="turn-meta"><time>{turn.timestamp}</time><strong>{turn.speaker}</strong><span className="turn-id">{turn.id}</span></div>
          <p lang={conversation.language === 'KZ' ? 'kk' : conversation.language.toLowerCase()}>{turn.text}</p>
          {target?.id === turn.id && <button className="evidence-return" type="button" onClick={() => focusEvidence(target.origin)}><Icon name="arrow" size={15} /> Back to {target.criterionId}</button>}
        </div>
      </li>)}
    </ol>
    <div className="transcript-footer"><Icon name="shield" size={14} /> Original transcript · Source timestamps preserved</div>
  </section>
}
