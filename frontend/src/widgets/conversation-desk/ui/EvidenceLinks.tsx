import type { Grade, Turn } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import type { EvidenceTarget } from './Transcript'

export function EvidenceLinks({ grade, turns, target, original, source, onEvidence }: {
  grade: Grade
  turns: Map<string, Turn>
  target: EvidenceTarget | null
  original?: boolean
  source?: string
  onEvidence: (target: EvidenceTarget) => void
}) {
  const { criterion_id: criterionId } = grade
  return <div className="evidence-links">
    {grade.evidence_turn_ids.map((id) => {
      const turn = turns.get(id)
      const current = target?.id === id && target.criterionId === criterionId
        && target.original === original && target.source === source
      return turn && <button className="evidence-link" type="button" key={id} aria-current={current ? 'true' : undefined}
        onClick={(event) => onEvidence({ id, criterionId, original, source, origin: event.currentTarget })}
        aria-label={`Show ${criterionId} ${original ? 'original ' : ''}evidence, turn ${id} at ${turn.timestamp}`}>
        <Icon name="link" size={15} /> <span>{id} · {turn.timestamp}</span><Icon name="arrowUpRight" size={13} />
      </button>
    })}
  </div>
}
