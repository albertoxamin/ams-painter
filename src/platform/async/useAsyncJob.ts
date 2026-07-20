import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncJobState<T> {
  busy: boolean
  error: string | null
  result: T | null
}

/** Run an async job with busy/error/result tracking. */
export function useAsyncJob<T>() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<T | null>(null)
  const runId = useRef(0)

  const run = useCallback(async (fn: () => Promise<T>) => {
    const id = ++runId.current
    setBusy(true)
    setError(null)
    try {
      const value = await fn()
      if (runId.current === id) setResult(value)
      return value
    } catch (err) {
      if (runId.current === id) {
        setError((err as Error).message || 'Operation failed')
        setResult(null)
      }
      throw err
    } finally {
      if (runId.current === id) setBusy(false)
    }
  }, [])

  const reset = useCallback(() => {
    runId.current++
    setBusy(false)
    setError(null)
    setResult(null)
  }, [])

  useEffect(() => () => {
    runId.current++
  }, [])

  return { busy, error, result, run, reset, setError }
}
