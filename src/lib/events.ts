import { api, getAccessToken, endLocalSession } from './api'
import { env } from './env'

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped'
export interface LumonEvent { id: number | null; type: string; data: Record<string, unknown> }

type Handler = (e: LumonEvent) => void
const handlers = new Map<string, Set<Handler>>()
const statusHandlers = new Set<(s: StreamStatus) => void>()
let status: StreamStatus = 'idle'
let lastId: number | null = null
const seenIds: number[] = []
const seenSet = new Set<number>()

const chan: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-events') : null

export const getStreamStatus = () => status
export const onStreamStatus = (f: (s: StreamStatus) => void) => { statusHandlers.add(f); return () => { statusHandlers.delete(f) } }
export function onEvent(type: string, h: Handler) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(h)
  return () => { handlers.get(type)?.delete(h) }
}
function setStatus(s: StreamStatus, broadcast = true) {
  status = s; statusHandlers.forEach((f) => f(s))
  if (broadcast) chan?.postMessage({ kind: 'status', status: s })
}
function remember(id: number): boolean {
  if (seenSet.has(id)) return false
  seenSet.add(id); seenIds.push(id)
  if (seenIds.length > 1000) seenSet.delete(seenIds.shift()!)
  return true
}
function dispatch(ev: LumonEvent) {
  if (ev.id !== null) { if (!remember(ev.id)) return; if (lastId === null || ev.id > lastId) lastId = ev.id }
  handlers.get(ev.type)?.forEach((h) => h(ev))
  handlers.get('*')?.forEach((h) => h(ev))
}
chan?.addEventListener('message', (m: MessageEvent<{ kind: string; ev?: LumonEvent; status?: StreamStatus }>) => {
  if (m.data.kind === 'event' && m.data.ev) dispatch(m.data.ev)
  if (m.data.kind === 'status' && m.data.status) setStatus(m.data.status, false)
})

const sleep = (ms: number, s: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms); s.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

/** Lee SSE con fetch para poder ver los comentarios de heartbeat (EventSource no los expone). */
async function readStream(ticket: string, signal: AbortSignal): Promise<'closed' | 'superseded' | 'dead'> {
  const url = `${env.api}/events/stream?ticket=${encodeURIComponent(ticket)}${lastId !== null ? `&lastEventId=${lastId}` : ''}`
  const ctl = new AbortController()
  let alive = Date.now()
  let dead = false
  const abort = () => ctl.abort()
  signal.addEventListener('abort', abort, { once: true })
  const watchdog = setInterval(() => { if (Date.now() - alive > 45_000) { dead = true; ctl.abort() } }, 5_000)
  try {
    const res = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal: ctl.signal })
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
    setStatus('open')
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return 'closed'
      alive = Date.now()
      buf += dec.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
        let id: number | null = null, type = 'message', data = ''
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(':')) continue
          const [k, ...rest] = line.split(':'); const v = rest.join(':').replace(/^ /, '')
          if (k === 'id') id = Number(v); else if (k === 'event') type = v; else if (k === 'data') data += (data ? '\n' : '') + v
        }
        if (!data && type === 'message') continue
        let parsed: Record<string, unknown> = {}
        try { parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {} } catch { continue }
        if (type === 'message' && typeof parsed.type === 'string') type = parsed.type
        const ev: LumonEvent = { id: Number.isFinite(id as number) ? id : null, type, data: (parsed.data as Record<string, unknown>) ?? parsed }
        if (type === 'stream.superseded') return 'superseded'
        if (type === 'stream.reset') { lastId = null; seenSet.clear(); seenIds.length = 0 }
        if (type === 'session.revoked') endLocalSession('SESSION_REVOKED')
        dispatch(ev)
        chan?.postMessage({ kind: 'event', ev })
      }
    }
  } catch (err) {
    if (dead) return 'dead'
    if ((err as Error).name === 'AbortError') return 'closed'
    throw err
  } finally {
    clearInterval(watchdog); signal.removeEventListener('abort', abort); ctl.abort()
  }
}

async function leaderLoop(signal: AbortSignal) {
  let attempt = 0
  while (!signal.aborted && getAccessToken()) {
    try {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      const t = await api<{ ticket: string }>('/events/tickets', { method: 'POST', retries: 1 })
      const r = await readStream(t.ticket, signal)
      attempt = r === 'superseded' ? 3 : 0
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'CLEARANCE_REQUIRED') { setStatus('stopped'); await sleep(15_000, signal); continue }
      attempt++
    }
    if (signal.aborted) break
    setStatus('reconnecting')
    await sleep(Math.min(1000 * 2 ** attempt, 20_000) + Math.random() * 500, signal)
  }
}

let ctl: AbortController | null = null
/** Una sola conexión por navegador: la pestaña que tiene el lock lee el stream y reenvía al resto. */
export function startEvents() {
  if (ctl) return
  ctl = new AbortController()
  const signal = ctl.signal
  if (!navigator.locks) { void leaderLoop(signal); return }
  void navigator.locks.request('lumon-sse-leader', { signal }, async () => {
    await leaderLoop(signal)
  }).catch(() => undefined)
}
export function stopEvents() { ctl?.abort(); ctl = null; setStatus('idle') }
