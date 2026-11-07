import { defaultChecklist, demoConversations, gradesByFixture } from './fixtures'
import { validateRecords } from './upload'
import type { Checklist, Conversation, Evaluation, Grade, QualityApi, RawRecord, Score } from './contract'

type Store = { conversations: Conversation[]; evaluations: Evaluation[] }
const storageKey = 'datadoom.synthetic.v1'

function asRaw(conversation: Conversation): RawRecord {
  const { conversation_id, channel, language, audio_url, turns } = conversation
  return { conversation_id, channel, language, audio_url, transcript: turns.map(({ timestamp, speaker, text }) => ({ timestamp, speaker, text })) }
}

function scoreGrades(checklist: Checklist, grades: Grade[]): Score {
  const rows = checklist.criteria.map((criterion, index) => ({ criterion, grade: grades[index] }))
  const weight = rows.reduce((sum, { criterion, grade }) => sum + (grade.value === 'na' ? 0 : criterion.weight), 0)
  const round = (value: number) => Math.round((value + Number.EPSILON * value) * 100) / 100
  const sections = new Map<string, { points: number; possible: number }>()
  let total = 0

  const items = rows.map(({ criterion, grade }) => {
    const effective = criterion.weight > 0 && grade.value !== 'na' ? 100 * criterion.weight / weight : null
    const ratio = typeof grade.value === 'number' ? grade.value / Math.max(...criterion.scale) : Number(grade.value === 'yes')
    const points = effective === null ? null : effective * ratio
    total += points ?? 0

    if (criterion.section) {
      const section = sections.get(criterion.section) ?? { points: 0, possible: 0 }
      section.points += points ?? 0
      section.possible += effective ?? 0
      sections.set(criterion.section, section)
    }

    return { ...grade, weight: criterion.weight, effective_weight: effective === null ? null : round(effective), points: points === null ? null : round(points) }
  })

  return {
    items,
    total: weight ? round(total) : null,
    serious_error: rows.some(({ criterion, grade }) => criterion.kind === 'flag' && grade.value === 'yes'),
    sections: Array.from(sections, ([name, { points, possible }]) => ({
      name, points: possible ? round(points) : null, possible: possible ? round(possible) : null,
    })),
  }
}

function makeEvaluation(conversation: Conversation, checklist: Checklist, id: string): Evaluation {
  const raw = JSON.stringify(asRaw(conversation))
  const fixture = demoConversations.find((demo) => raw === JSON.stringify(asRaw(demo)))
  const firstOperatorTurn = conversation.turns.find((turn) => turn.speaker === 'operator' && turn.text.trim())
  const context = firstOperatorTurn ?? conversation.turns.find((turn) => turn.text.trim())!
  const grades: Grade[] = fixture ? gradesByFixture[fixture.key] : checklist.criteria.map((criterion) => ({
    criterion_id: criterion.id,
    value: criterion.kind === 'scale' ? criterion.scale[0] : 'no',
    reason: 'Synthetic placeholder for this transcript. The fixture mode does not assess its content.',
    evidence_turn_ids: [context.id],
  }))
  const original = scoreGrades(checklist, grades)
  return {
    id, conversation_key: conversation.key, checklist, mode: 'fixture',
    model: { provider: 'fixture', model: 'synthetic-v1' }, original, final: original, appeals: [],
  }
}

function readStore(): Store {
  const stored = localStorage.getItem(storageKey)
  if (stored) {
    const store: Store = JSON.parse(stored)
    const call = demoConversations.find((item) => item.channel === 'voice call')!
    return { ...store, conversations: store.conversations.map((item) => item.key === call.key ? call : item) }
  }
  return {
    conversations: demoConversations,
    evaluations: [makeEvaluation(demoConversations[0], defaultChecklist, 'fixture-001')],
  }
}

const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 240))

export const mockApi: QualityApi = {
  async importConversations(input) {
    await pause()
    const group = input.group_id.trim()
    if (!group) throw new Error('Enter a group ID.')
    if (input.source === 'organizer' && group !== 'SYNTH') {
      throw new Error('The synthetic organizer source only contains group SYNTH. Use SYNTH or upload a synthetic JSON file.')
    }

    const records = input.source === 'organizer' ? demoConversations.map(asRaw) : validateRecords(input.records)
    const store = readStore()
    const conversations = [...store.conversations]
    let imported = 0
    let skipped = 0
    for (const record of records) {
      const match = conversations.find((item) => item.group_id === group && item.conversation_id === record.conversation_id)
      if (match) {
        if (JSON.stringify(asRaw(match)) !== JSON.stringify(record)) {
          throw new Error(`Conversation ${record.conversation_id} already exists in ${group} with different source data.`)
        }
        skipped++
        continue
      }
      const { transcript, ...summary } = record
      conversations.push({
        ...summary, key: crypto.randomUUID(), group_id: group,
        turns: transcript.map((turn, index) => ({ ...turn, id: `t${index + 1}` })),
      })
      imported++
    }
    if (imported) localStorage.setItem(storageKey, JSON.stringify({ ...store, conversations }))
    return { group_id: group, imported, skipped }
  },

  async listConversations() {
    return { items: readStore().conversations.map(({ turns: _turns, ...summary }) => summary) }
  },

  async getConversation(key) {
    const conversation = readStore().conversations.find((item) => item.key === key)
    if (!conversation) throw new Error('Conversation not found.')
    return conversation
  },

  async listChecklists() {
    return { items: [defaultChecklist] }
  },

  async listEvaluations(key) {
    return { items: readStore().evaluations.filter((item) => item.conversation_key === key) }
  },

  async evaluate(key, versionId) {
    await pause()
    const store = readStore()
    const conversation = store.conversations.find((item) => item.key === key)
    if (!conversation) throw new Error('Conversation not found.')
    if (versionId !== defaultChecklist.version_id) throw new Error('Checklist version not found.')
    const evaluation = makeEvaluation(conversation, defaultChecklist, crypto.randomUUID())
    localStorage.setItem(storageKey, JSON.stringify({ ...store, evaluations: [evaluation, ...store.evaluations] }))
    return evaluation
  },
}
