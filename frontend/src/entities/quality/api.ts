import type { QualityApi } from './contract'

export const isMockMode = import.meta.env.VITE_API_MODE === 'mock'

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      signal,
      ...(body === undefined ? {} : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the API. Check the connection and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message
    throw new Error(typeof message === 'string' && message.trim()
      ? message
      : `The API returned HTTP ${response.status}. Try again.`)
  }
  if (payload === null) throw new Error('The API did not return JSON. Check the backend connection and try again.')
  return payload as T
}

const liveApi: QualityApi = {
  importConversations: (input) => request('/imports', undefined, input),
  listConversations: (signal) => request('/conversations', signal),
  getConversation: (key, signal) => request(`/conversations/${encodeURIComponent(key)}`, signal),
  listChecklists: (signal) => request('/checklists', signal),
  listEvaluations: (key, signal) => request(`/evaluations?${new URLSearchParams({ conversation_key: key })}`, signal),
  evaluate: (key, versionId) => request('/evaluations', undefined, {
    conversation_key: key,
    checklist_version_id: versionId,
  }),
}

export const qualityApi: QualityApi = isMockMode
  ? (await import('./mock')).mockApi
  : liveApi
