export function recordingLink(url: string | null) {
  if (!url?.trim()) return null
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const part = (value: number) => String(value).padStart(2, '0')
  return `${whole >= 3600 ? `${Math.floor(whole / 3600)}:` : ''}${part(Math.floor(whole / 60) % 60)}:${part(whole % 60)}`
}
