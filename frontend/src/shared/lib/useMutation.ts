import { useRef, useState } from 'react'
import { errorMessage } from './errorMessage'

export function useMutation() {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(write: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await write()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return { pending, error, run, clearError: () => setError(null) }
}
