import { ApiError, get, post } from '../../../shared/api/http'
import { isMockMode } from '../../../shared/config/apiMode'
import type { Conversation, ConversationSummary, EvaluationJob, JudgeStatus, QualityApi, ResultsExport } from '../model/contract'

let jobsSupported = true

async function optionalRoute<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request()
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null
    throw error
  }
}

const liveApi: QualityApi = {
  importConversations: (input) => post('/imports', input),
  async listConversations(signal) {
    try {
      return await get<{ items: ConversationSummary[] }>('/conversations?include=latest', signal)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 422)) return get<{ items: ConversationSummary[] }>('/conversations', signal)
      throw error
    }
  },
  getConversation: (key, signal) => get(`/conversations/${encodeURIComponent(key)}`, signal),
  listChecklists: (signal) => get('/checklists', signal),
  createChecklist: (draft) => post('/checklists', draft),
  listEvaluations: (key, signal) => get(`/evaluations?${new URLSearchParams({ conversation_key: key })}`, signal),
  getEvaluation: (id, signal) => get(`/evaluations/${encodeURIComponent(id)}`, signal),
  evaluate: (key, versionId, locale) => post('/evaluations', {
    conversation_key: key,
    checklist_version_id: versionId,
    reason_locale: locale,
  }),
  async startEvaluationJob(key, versionId, locale) {
    if (!jobsSupported) return null
    const job = await optionalRoute(() => post<EvaluationJob>('/evaluation-jobs', {
      conversation_key: key, checklist_version_id: versionId, reason_locale: locale,
    }))
    if (!job) jobsSupported = false
    return job
  },
  getEvaluationJob: (id, signal) => get(`/evaluation-jobs/${encodeURIComponent(id)}`, signal),
  async listEvaluationJobs(filters = {}, signal) {
    if (!jobsSupported) return { items: [] }
    const query = new URLSearchParams()
    if (filters.conversation_key) query.set('conversation_key', filters.conversation_key)
    if (filters.active !== undefined) query.set('active', String(filters.active))
    return await optionalRoute(() => get<{ items: EvaluationJob[] }>(`/evaluation-jobs?${query}`, signal)) ?? { items: [] }
  },
  startGroupEvaluation: (groupId, versionId, locale) => optionalRoute(() => post<{ items: EvaluationJob[] }>('/evaluation-jobs/batch', {
    group_id: groupId, checklist_version_id: versionId, skip_existing: true, reason_locale: locale,
  })),
  cancelEvaluationJob: (id) => post(`/evaluation-jobs/${encodeURIComponent(id)}/cancel`, {}),
  getJudges: (signal) => optionalRoute(() => get<JudgeStatus>('/judges', signal)),
  exportResults: (groupId, versionId, teamName, signal) => optionalRoute(() => get<ResultsExport>(`/exports/results?${new URLSearchParams({
    group_id: groupId, checklist_version_id: versionId, team_name: teamName, use_final: 'false',
  })}`, signal)),
  submitAppeal: (id, criterionId, comment) => post(`/evaluations/${encodeURIComponent(id)}/appeals`, {
    criterion_id: criterionId,
    comment,
  }),
  decideAppeal: (id, criterionId, decision) =>
    post(`/evaluations/${encodeURIComponent(id)}/appeals/${encodeURIComponent(criterionId)}/decision`, decision),
}

export const qualityApi: QualityApi = isMockMode
  ? (await import('./mock')).mockApi
  : liveApi

export const demoRecordingOffsets: (conversation: Conversation) => ReadonlyMap<string, number> | undefined = isMockMode
  ? (await import('./fixtures')).demoRecordingOffsets
  : () => undefined
