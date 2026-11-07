import { defaultChecklist, demoConversations, gradesByFixture } from './fixtures'
import { validateRecords } from './upload'
import type { Checklist, Conversation, Evaluation, Grade, QualityApi, RawRecord } from '../model/contract'
import { allowedGradeValues, validateCriterion } from '../model/rubric'
import { scoreGrades } from './scoreGrades'

type Store = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: Checklist[] }
const storageKey = 'datadoom.synthetic.v1'

function asRaw(conversation: Conversation): RawRecord {
  const { conversation_id, channel, language, audio_url, turns } = conversation
  return { conversation_id, channel, language, audio_url, transcript: turns.map(({ timestamp, speaker, text }) => ({ timestamp, speaker, text })) }
}

function makeEvaluation(conversation: Conversation, checklist: Checklist, id: string): Evaluation {
  const raw = JSON.stringify(asRaw(conversation))
  const fixture = demoConversations.find((demo) => raw === JSON.stringify(asRaw(demo)))
  const firstOperatorTurn = conversation.turns.find((turn) => turn.speaker === 'operator' && turn.text.trim())
  const context = firstOperatorTurn ?? conversation.turns.find((turn) => turn.text.trim())!
  const grades = checklist.criteria.map((criterion): Grade => {
    const seeded = defaultChecklist.criteria.find(({ id }) => id === criterion.id)
    const fixed = fixture && gradesByFixture[fixture.key].find(({ criterion_id }) => criterion_id === criterion.id)
    if (fixed && seeded && seeded.label === criterion.label && seeded.instruction === criterion.instruction &&
      seeded.kind === criterion.kind && seeded.na_rule === criterion.na_rule &&
      seeded.allow_na === criterion.allow_na && seeded.scale.join(',') === criterion.scale.join(',')) {
      return fixed
    }
    return {
      criterion_id: criterion.id,
      value: criterion.kind === 'scale' ? criterion.scale[0] : 'no',
      reason: 'Synthetic placeholder. This transcript and criterion combination has no fixed fixture grade.',
      evidence_turn_ids: [context.id],
    }
  })
  const original = scoreGrades(checklist, grades)
  return {
    id, conversation_key: conversation.key, checklist, mode: 'fixture',
    model: { provider: 'fixture', model: 'synthetic-v1' }, original, final: original, appeals: [],
  }
}

function readStore(): Store {
  const stored = localStorage.getItem(storageKey)
  if (stored) {
    const store: Omit<Store, 'checklists'> & { checklists?: Checklist[] } = JSON.parse(stored)
    const call = demoConversations.find((item) => item.channel === 'voice call')!
    return {
      ...store,
      checklists: store.checklists ?? [defaultChecklist],
      conversations: store.conversations.map((item) => item.key === call.key ? call : item),
    }
  }
  return {
    conversations: demoConversations,
    evaluations: [makeEvaluation(demoConversations[0], defaultChecklist, 'fixture-001')],
    checklists: [defaultChecklist],
  }
}

const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 240))

function writeStore(store: Store) {
  localStorage.setItem(storageKey, JSON.stringify(store))
}

function getEvaluation(store: Store, id: string) {
  const evaluation = store.evaluations.find((item) => item.id === id)
  if (!evaluation) throw new Error('Evaluation not found.')
  return evaluation
}

function saveEvaluation(store: Store, evaluation: Evaluation) {
  writeStore({ ...store, evaluations: store.evaluations.map((item) => item.id === evaluation.id ? evaluation : item) })
  return evaluation
}

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
    if (imported) writeStore({ ...store, conversations })
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
    return { items: readStore().checklists }
  },

  async createChecklist(draft) {
    await pause()
    if (!draft.name.trim()) throw new Error('Enter a checklist name.')
    if (!draft.criteria.some(({ kind }) => kind !== 'flag')) throw new Error('Keep at least one weighted criterion.')
    if (new Set(draft.criteria.map(({ id }) => id)).size !== draft.criteria.length) {
      throw new Error('Criterion IDs must be unique.')
    }
    for (const criterion of draft.criteria) {
      const error = validateCriterion(criterion)
      if (error) throw new Error(error)
    }
    const store = readStore()
    const checklist = { ...draft, version_id: `fixture-v${store.checklists.length + 1}` }
    writeStore({ ...store, checklists: [checklist, ...store.checklists] })
    return checklist
  },

  async listEvaluations(key) {
    return { items: readStore().evaluations.filter((item) => item.conversation_key === key) }
  },

  async evaluate(key, versionId) {
    await pause()
    const store = readStore()
    const conversation = store.conversations.find((item) => item.key === key)
    if (!conversation) throw new Error('Conversation not found.')
    const checklist = store.checklists.find(({ version_id }) => version_id === versionId)
    if (!checklist) throw new Error('Checklist version not found.')
    const evaluation = makeEvaluation(conversation, checklist, crypto.randomUUID())
    writeStore({ ...store, evaluations: [evaluation, ...store.evaluations] })
    return evaluation
  },

  async submitAppeal(id, criterionId, comment) {
    await pause()
    const store = readStore()
    const evaluation = getEvaluation(store, id)
    if (!evaluation.checklist.criteria.some((criterion) => criterion.id === criterionId)) throw new Error('Criterion not found.')
    if (!comment.trim()) throw new Error('Enter an appeal comment.')
    if (evaluation.appeals.some(({ criterion_id }) => criterion_id === criterionId)) {
      throw new Error('An appeal already exists for this criterion.')
    }
    return saveEvaluation(store, {
      ...evaluation,
      appeals: [...evaluation.appeals, { criterion_id: criterionId, comment: comment.trim(), status: 'open', decision: null }],
    })
  },

  async decideAppeal(id, criterionId, decision) {
    await pause()
    const store = readStore()
    const evaluation = getEvaluation(store, id)
    const appeal = evaluation.appeals.find(({ criterion_id }) => criterion_id === criterionId)
    if (!appeal || appeal.status !== 'open') throw new Error('This appeal is no longer open.')
    if (!decision.reason.trim()) throw new Error('Enter a decision reason.')
    if (decision.action === 'change') {
      const criterion = evaluation.checklist.criteria.find(({ id }) => id === criterionId)!
      const turns = store.conversations.find(({ key }) => key === evaluation.conversation_key)!.turns
      const replacement = decision.replacement
      if (!replacement || replacement.criterion_id !== criterionId ||
        !allowedGradeValues(criterion).includes(replacement.value) || !replacement.reason.trim() ||
        !replacement.evidence_turn_ids.length || replacement.evidence_turn_ids.some((id) => !turns.some((turn) => turn.id === id))) {
        throw new Error('Enter an allowed grade, a rationale and evidence from this conversation.')
      }
    }
    const appeals = evaluation.appeals.map((item) => item === appeal ? { ...item, status: 'resolved' as const, decision } : item)
    const replacements = new Map(appeals.flatMap(({ decision }) =>
      decision?.action === 'change' && decision.replacement ? [[decision.replacement.criterion_id, decision.replacement] as const] : [],
    ))
    const grades = evaluation.original.items.map((grade) => replacements.get(grade.criterion_id) ?? grade)
    return saveEvaluation(store, { ...evaluation, appeals, final: scoreGrades(evaluation.checklist, grades) })
  },
}
