import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'

/** Re-run a loader now and every 15 s. Errors: 'not-found' (404), 'forbidden' (403) or a message. */
export function useLiveData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  const refresh = useCallback(() => {
    run()
      .then((d) => {
        setData(d)
        setError(null)
        setUpdatedAt(Date.now())
      })
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'not-found'
            : err instanceof ApiError && err.status === 403
              ? 'forbidden'
              : 'Data could not be loaded. Try Refresh.',
        ),
      )
  }, [run])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(id)
  }, [refresh])

  return { data, error, updatedAt, refresh }
}
