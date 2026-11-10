import { useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

export const intParam = (v: string | null, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}

export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!(err instanceof ApiError)) return out
  const d = err.details as unknown
  const put = (k: unknown, m: unknown) => { if (typeof k === 'string' && typeof m === 'string') out[k] = m }
  if (Array.isArray(d)) d.forEach((x: { field?: string; message?: string }) => put(x.field, x.message))
  else if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>
    const inner = (o.fields ?? o.errors ?? o) as Record<string, unknown>
    Object.entries(inner).forEach(([k, v]) => put(k, Array.isArray(v) ? v[0] : v))
  }
  if (err.code === 'EMAIL_TAKEN' || err.code === 'EMAIL_ALREADY_REGISTERED') out.email ??= err.message
  if (err.code === 'TEAM_NAME_TAKEN' || err.code === 'TEAM_ALREADY_REGISTERED') out.teamName ??= err.message
  return out
}

/** Ejecuta una carga con cancelación y descarta respuestas viejas. */
export function useLatestLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const my = ++seq.current
    const ctl = new AbortController()
    setLoading(true); setError(null)
    load(ctl.signal)
      .then((d) => { if (my === seq.current) { setData(d); setLoading(false) } })
      .catch((e: Error) => { if (e.name !== 'AbortError' && my === seq.current) { setError(e); setLoading(false) } })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return { data, setData, error, loading, reload: () => setNonce((n) => n + 1) }
}
