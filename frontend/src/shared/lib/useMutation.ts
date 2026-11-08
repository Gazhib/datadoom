import { useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { captureError, errorMessage } from './errorMessage'

export function useMutation() {
  const { t } = useI18n()
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function run(write: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await write()
    } catch (failure) {
      setError(captureError(failure))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return { pending, error: error && errorMessage(error, t), run, clearError: () => setError(null) }
}
