import { useEffect, useState } from 'react'

type Remote<T> = { data: T | null; loading: boolean; error: string | null }

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>) {
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
          setState((previous) => ({ ...previous, loading: false, error: errorMessage(error) }))
        }
      },
    )
    return () => controller.abort()
  }, [load, version])

  function refresh() {
    setState((previous) => ({ ...previous, loading: true, error: null }))
    setVersion((value) => value + 1)
  }

  return { ...state, refresh }
}
