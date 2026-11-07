import { get, post } from '../../../shared/api/http'
import { isMockMode } from '../../../shared/config/apiMode'
import type { QualityApi } from '../model/contract'

const liveApi: QualityApi = {
  importConversations: (input) => post('/imports', input),
  listConversations: (signal) => get('/conversations', signal),
  getConversation: (key, signal) => get(`/conversations/${encodeURIComponent(key)}`, signal),
  listChecklists: (signal) => get('/checklists', signal),
  createChecklist: (draft) => post('/checklists', draft),
  listEvaluations: (key, signal) => get(`/evaluations?${new URLSearchParams({ conversation_key: key })}`, signal),
  evaluate: (key, versionId) => post('/evaluations', {
    conversation_key: key,
    checklist_version_id: versionId,
  }),
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
