async function request<T>(path: string, options: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
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

export function get<T>(path: string, signal?: AbortSignal) {
  return request<T>(path, { signal })
}

export function post<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
