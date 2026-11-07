import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import type { Conversation } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'

export type EvidenceTarget = { id: string; criterionId: string; original?: boolean; origin: HTMLButtonElement }

function focusEvidence(element: HTMLElement) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.focus({ preventScroll: true })
  element.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' })
  return reduceMotion
}

function recordingLink(url: string | null) {
  if (!url?.trim()) return null
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export function Transcript({ conversation, target }: { conversation: Conversation; target: EvidenceTarget | null }) {
  const transcript = useRef<HTMLOListElement>(null)
  const recording = recordingLink(conversation.audio_url)

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
      <div className="pane-title"><span className="panel-icon"><Icon name="file" size={19} /></span><h2 id="transcript-heading" tabIndex={-1}>Transcript</h2></div>
      <span className="quiet-chip">{conversation.turns.length} {conversation.turns.length === 1 ? 'turn' : 'turns'}</span>
    </header>
    {conversation.channel === 'voice call' && <div className="recording-row">
      <span><Icon name="phone" size={16} /> Call recording</span>
      {recording
        ? <a href={recording} target="_blank" rel="noopener noreferrer">Open recording <Icon name="arrowUpRight" size={15} /></a>
        : <span className="form-note">Recording unavailable</span>}
    </div>}
    <ol className="turns" ref={transcript}>
      {conversation.turns.map((turn) => <li className={`turn turn-${turn.speaker}${target?.id === turn.id ? ' turn-highlighted' : ''}`} key={turn.id} data-turn={turn.id} tabIndex={-1}>
        <span className="turn-indicator" aria-hidden="true" />
        <span className="speaker-icon" aria-hidden="true">{turn.speaker[0].toUpperCase()}</span>
        <div className="turn-copy">
          <div className="turn-meta"><strong>{turn.speaker}</strong><span className="turn-id">{turn.id}</span><time>{turn.timestamp}</time></div>
          <p lang={conversation.language === 'KZ' ? 'kk' : conversation.language.toLowerCase()}>{turn.text}</p>
          {target?.id === turn.id && <button className="evidence-return" type="button" onClick={() => focusEvidence(target.origin)}><Icon name="arrow" size={15} /> Back to {target.criterionId}</button>}
        </div>
      </li>)}
    </ol>
    <div className="transcript-footer"><Icon name="clock" size={14} /> Timestamps follow the source transcript.</div>
  </section>
}
