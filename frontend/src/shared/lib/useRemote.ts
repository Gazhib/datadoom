import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { captureError, errorMessage } from './errorMessage'

type Remote<T> = { data: T | null; loading: boolean; error: Error | null }

export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>) {
  const { t } = useI18n()
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<Remote<T>>({ data: null, loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState((previous) => ({ ...previous, loading: false, error: captureError(error) }))
        }
      },
    )
    return () => controller.abort()
  }, [load, version])

  function refresh() {
    setState((previous) => ({ ...previous, loading: true, error: null }))
    setVersion((value) => value + 1)
  }

  return { ...state, error: state.error && errorMessage(state.error, t), refresh }
}
