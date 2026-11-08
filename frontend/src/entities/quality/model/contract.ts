import type { Locale } from '../../../shared/i18n/messages'

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
  latest?: {
    evaluation_id: string
    checklist_version_id: string
    mode: 'live' | 'fixture'
    total: number | null
    serious_error: boolean
  } | null
}

export type Conversation = ConversationSummary & { turns: Turn[] }
export type RawRecord = Omit<ConversationSummary, 'key' | 'group_id' | 'latest'> & {
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

export type ChecklistDraft = { name: string; criteria: Criterion[] }
export type Checklist = ChecklistDraft & { version_id: string }
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
  panel?: Panel | null
}

export type PanelVote = {
  criterion_id: string
  value: Grade['value']
  agreement: number
  ballots: Record<string, Grade['value']>
}

export type Panel = {
  quorum: number
  agreement: number
  judges: {
    name: string
    provider: string
    model: string
    host: string
    fallback: boolean
    status: 'ok' | 'failed' | 'skipped'
    error_code: string | null
    seconds: number | null
    // Each judge's own grades. Older evaluations and failed judges omit them.
    grades?: Grade[] | null
  }[]
  votes: PanelVote[]
}

export type EvaluationJob = {
  id: string
  conversation_key: string
  checklist_version_id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  created_at: string
  started_at: string | null
  finished_at: string | null
  queue_position: number | null
  progress: { judges: {
    name: string
    status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped'
    host: string | null
    seconds: number | null
    error_code?: string | null
    grades?: Grade[] | null
  }[] } | null
  evaluation_id: string | null
  error: { code: string; message: string } | null
}

export type JobFilters = { conversation_key?: string; active?: boolean }
export type JudgeStatus = {
  execution: string
  quorum: number
  timeout_seconds: number
  judges: {
    name: string
    provider: string
    model: string
    host: string
    reachable: boolean
    model_available: boolean | null
    fallback_host: string | null
    fallback_reachable: boolean | null
  }[]
}

export type ResultsExport = {
  schema_version: string
  team_name: string
  model: { mode: 'local' | 'external_api' | 'hybrid'; name: string }
  results: unknown[]
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
  createChecklist(draft: ChecklistDraft): Promise<Checklist>
  listEvaluations(key: string, signal?: AbortSignal): Promise<Items<Evaluation>>
  getEvaluation(id: string, signal?: AbortSignal): Promise<Evaluation>
  evaluate(key: string, versionId: string, locale: Locale): Promise<Evaluation>
  // null means that the optional route is unavailable on this backend.
  startEvaluationJob(key: string, versionId: string, locale: Locale): Promise<EvaluationJob | null>
  getEvaluationJob(id: string, signal?: AbortSignal): Promise<EvaluationJob>
  listEvaluationJobs(filters?: JobFilters, signal?: AbortSignal): Promise<Items<EvaluationJob>>
  startGroupEvaluation(groupId: string, versionId: string, locale: Locale): Promise<Items<EvaluationJob> | null>
  cancelEvaluationJob(id: string): Promise<EvaluationJob>
  getJudges(signal?: AbortSignal): Promise<JudgeStatus | null>
  exportResults(groupId: string, versionId: string, teamName: string, signal?: AbortSignal): Promise<ResultsExport | null>
  submitAppeal(evaluationId: string, criterionId: string, comment: string): Promise<Evaluation>
  decideAppeal(evaluationId: string, criterionId: string, decision: Decision): Promise<Evaluation>
}
