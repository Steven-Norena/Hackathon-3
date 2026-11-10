import { env } from './env'

export interface ApiErrorBody { error: string; message: string; details?: unknown; requestId?: string }

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  retryAfter: number | null
  constructor(status: number, code: string, message: string, details: unknown = null, retryAfter: number | null = null) {
    super(message)
    this.status = status; this.code = code; this.details = details; this.retryAfter = retryAfter
  }
}

export interface User { id: number; email: string; displayName: string }
export interface Session { accessToken: string; refreshToken: string; expiresIn: number; user: User }

const REFRESH_KEY = 'lumon.refresh'
const LOCK = 'lumon-refresh'
const chan: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-session') : null

// El access token vive SOLO en memoria.
let accessToken: string | null = null
let tokenGeneration = 0
let inflightRefresh: Promise<void> | null = null

type SessionLostReason = 'REFRESH_REUSED' | 'SESSION_REVOKED' | 'TOKEN_INVALID' | 'LOGOUT' | 'EXPIRED'
const lostListeners = new Set<(r: SessionLostReason) => void>()
export const onSessionLost = (fn: (r: SessionLostReason) => void) => { lostListeners.add(fn); return () => { lostListeners.delete(fn) } }
const tokenListeners = new Set<(t: string | null) => void>()
export const onAccessToken = (fn: (t: string | null) => void) => { tokenListeners.add(fn); return () => { tokenListeners.delete(fn) } }

export const getAccessToken = () => accessToken
export const hasStoredRefresh = () => { try { return !!localStorage.getItem(REFRESH_KEY) } catch { return false } }
const readRefresh = () => { try { return localStorage.getItem(REFRESH_KEY) } catch { return null } }
const writeRefresh = (t: string | null) => { try { if (t) localStorage.setItem(REFRESH_KEY, t); else localStorage.removeItem(REFRESH_KEY) } catch { /* ignore */ } }

function setAccess(t: string | null, announce = true) {
  accessToken = t; tokenGeneration++
  if (announce && t) chan?.postMessage({ type: 'token', token: t })
  tokenListeners.forEach((f) => f(t))
}

export function applySession(s: Session) {
  writeRefresh(s.refreshToken)
  setAccess(s.accessToken)
}

function dropSession(reason: SessionLostReason, announce: boolean) {
  accessToken = null; tokenGeneration++
  writeRefresh(null)
  if (announce) chan?.postMessage({ type: 'lost', reason })
  lostListeners.forEach((f) => f(reason))
}
export const endLocalSession = (reason: SessionLostReason = 'LOGOUT') => dropSession(reason, true)

chan?.addEventListener('message', (ev: MessageEvent<{ type: string; token?: string; reason?: SessionLostReason }>) => {
  const m = ev.data
  if (m.type === 'token' && m.token) setAccess(m.token, false)
  if (m.type === 'lost') dropSession(m.reason ?? 'LOGOUT', false)
})
// Respaldo: si otra pestaña borra el refresh token, esta cierra sesión.
window.addEventListener('storage', (ev) => {
  if (ev.key === REFRESH_KEY && ev.newValue === null && accessToken) dropSession('LOGOUT', false)
})

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) }, { once: true })
})

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {}
  try { body = await res.json() } catch { /* sin cuerpo */ }
  const ra = res.headers.get('Retry-After')
  return new ApiError(res.status, body.error ?? `HTTP_${res.status}`, body.message ?? res.statusText, body.details ?? null, ra ? Number(ra) : null)
}

function baseHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  h.set('X-Lumon-Build', env.build)
  return h
}

async function rawJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(env.api + path, init)
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Un solo refresh a la vez, también entre pestañas (Web Locks). */
function refreshSession(): Promise<void> {
  if (inflightRefresh) return inflightRefresh
  const genAtStart = tokenGeneration
  const run = async () => {
    // Otra pestaña pudo haber rotado mientras esperábamos el lock: nos llegó un token nuevo por BroadcastChannel.
    if (tokenGeneration !== genAtStart && accessToken) return
    const rt = readRefresh()
    if (!rt) { dropSession('EXPIRED', true); throw new ApiError(401, 'NO_REFRESH', 'Sin sesión') }
    try {
      const s = await rawJson<Session>('/auth/refresh', {
        method: 'POST', headers: baseHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ refreshToken: rt }),
      })
      applySession(s)
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'REFRESH_REUSED' || err.code === 'SESSION_REVOKED' || err.code === 'TOKEN_INVALID' || err.status === 401)) {
        dropSession((err.code === 'REFRESH_REUSED' || err.code === 'SESSION_REVOKED' ? err.code : 'EXPIRED') as SessionLostReason, true)
      }
      throw err
    }
  }
  inflightRefresh = (navigator.locks ? navigator.locks.request(LOCK, run) : run()).finally(() => { inflightRefresh = null })
  return inflightRefresh
}

export async function restoreSession(): Promise<boolean> {
  if (!hasStoredRefresh()) return false
  try { await refreshSession(); return true } catch (err) {
    if (err instanceof ApiError && err.status < 500 && err.status !== 429) return false
    throw err
  }
}

// Compuerta global para 429: nadie pide hasta que pase Retry-After.
let blockedUntil = 0
export const rateBlockedMs = () => Math.max(0, blockedUntil - Date.now())

export interface ReqOpts {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  auth?: boolean
  signal?: AbortSignal
  retries?: number
  gate?: boolean
}
export interface ApiResponse<T> { data: T; headers: Headers; status: number }

export async function apiFull<T>(path: string, o: ReqOpts = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, auth = true, signal, retries = 4, gate = false } = o
  let attempt = 0
  let refreshed = false
  for (;;) {
    if (gate) { const w = rateBlockedMs(); if (w > 0) await sleep(w, signal) }
    const h = baseHeaders(o.headers)
    if (body !== undefined && !(body instanceof FormData)) h.set('Content-Type', 'application/json')
    if (auth && accessToken) h.set('Authorization', `Bearer ${accessToken}`)
    let res: Response
    try {
      res = await fetch(env.api + path, { method, headers: h, signal, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) })
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      if (attempt++ < retries) { await sleep(Math.min(500 * 2 ** attempt, 8000) + Math.random() * 200, signal); continue }
      throw new ApiError(0, 'NETWORK_ERROR', 'No hay conexión con Lumon.')
    }
    if (res.ok) {
      const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
      return { data, headers: res.headers, status: res.status }
    }
    const err = await parseError(res)
    if (err.code === 'TOKEN_EXPIRED' && auth && !refreshed) {
      refreshed = true
      await refreshSession()
      continue
    }
    if (err.code === 'REFRESH_REUSED' || err.code === 'SESSION_REVOKED' || (err.code === 'TOKEN_INVALID' && auth)) {
      dropSession(err.code === 'TOKEN_INVALID' ? 'TOKEN_INVALID' : err.code, true)
      throw err
    }
    if (err.status === 429 && attempt++ < retries + 2) {
      const wait = (err.retryAfter ?? 1) * 1000
      blockedUntil = Math.max(blockedUntil, Date.now() + wait)
      await sleep(wait, signal)
      continue
    }
    if (err.status === 503 && attempt++ < retries) {
      await sleep(err.retryAfter ? err.retryAfter * 1000 : Math.min(500 * 2 ** attempt, 8000), signal)
      continue
    }
    throw err
  }
}

export const api = async <T>(path: string, o?: ReqOpts) => (await apiFull<T>(path, o)).data

export const uuid = () => crypto.randomUUID()

// ---- Auth ----
export const login = async (email: string, password: string) => {
  const s = await api<Session>('/auth/login', { method: 'POST', body: { email, password }, auth: false })
  applySession(s); return s
}
export const register = async (teamName: string, email: string, password: string) => {
  const s = await api<Session>('/auth/register', { method: 'POST', body: { teamName, name: teamName, email, password }, auth: false })
  applySession(s); return s
}
export const logout = async () => {
  const rt = readRefresh()
  try { await api('/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false }) } catch { /* revocar es best effort local */ }
  endLocalSession('LOGOUT')
}
