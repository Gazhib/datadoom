export type Speaker = 'client' | 'operator' | 'bot' | 'system'
export type Channel = 'agent chat' | 'voice call'
export type Language = 'RU' | 'KZ' | 'EN'
export type Turn = { id: string; timestamp: string; speaker: Speaker; text: string }

export type ConversationSummary = {
  key: string
  group_id: string
  conversation_id: string
  channel: Channel
  language: Language
  audio_url: string | null
}

export type Conversation = ConversationSummary & { turns: Turn[] }
export type RawRecord = Omit<ConversationSummary, 'key' | 'group_id'> & {
  transcript: Omit<Turn, 'id'>[]
}

export type Criterion = {
  id: string
  label: string
  instruction: string
  kind: 'binary' | 'scale' | 'flag'
  weight: number
  scale: number[]
  allow_na: boolean
  na_rule: string | null
  section: string | null
}

export type Checklist = { version_id: string; name: string; criteria: Criterion[] }
export type Grade = {
  criterion_id: string
  value: 'yes' | 'no' | 'na' | number
  reason: string
  evidence_turn_ids: string[]
}

export type Score = {
  items: (Grade & { weight: number; effective_weight: number | null; points: number | null })[]
  total: number | null
  serious_error: boolean
  sections: { name: string; points: number | null; possible: number | null }[]
}

export type Decision = { action: 'confirm' | 'change'; reason: string; replacement?: Grade }
export type Appeal = {
  criterion_id: string
  comment: string
  status: 'open' | 'resolved'
  decision: Decision | null
}

export type Evaluation = {
  id: string
  conversation_key: string
  checklist: Checklist
  mode: 'live' | 'fixture'
  model: { provider: string; model: string }
  original: Score
  final: Score
  appeals: Appeal[]
}

export type ImportRequest =
  | { source: 'organizer'; group_id: string }
  | { source: 'upload'; group_id: string; records: RawRecord[] }

export type ImportResult = { group_id: string; imported: number; skipped: number }

type Items<T> = { items: T[] }

export interface QualityApi {
  importConversations(input: ImportRequest): Promise<ImportResult>
  listConversations(signal?: AbortSignal): Promise<Items<ConversationSummary>>
  getConversation(key: string, signal?: AbortSignal): Promise<Conversation>
  listChecklists(signal?: AbortSignal): Promise<Items<Checklist>>
  listEvaluations(key: string, signal?: AbortSignal): Promise<Items<Evaluation>>
  evaluate(key: string, versionId: string): Promise<Evaluation>
}
