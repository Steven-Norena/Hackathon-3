import { api } from './api'
import { env } from './env'

export type FloorStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
export interface Member { userId: number; displayName: string }
export interface Claim { claimId: string; userId: number; cells: { r: number; c: number }[]; expiresAt?: string }
type Msg = Record<string, unknown> & { type: string }

const FINAL = new Set([4400, 4403, 4404, 4423])
const CLOSE_TEXT: Record<number, string> = {
  4400: 'Error interno de mensajes del piso. No se reconecta.', 4403: 'Origen no verificado o sin permiso para el piso.',
  4404: 'El archivo no existe.', 4423: 'El Piso de Pruebas no está abierto.',
}

export class FloorClient {
  status: FloorStatus = 'idle'
  statusMsg = ''
  members = new Map<number, Member>()
  claims = new Map<string, Claim>()
  cursors = new Map<number, { r: number; c: number }>()
  metaVersion = 0
  cursorVersion = 0
  private metaL = new Set<() => void>()
  private curL = new Set<() => void>()
  private ws: WebSocket | null = null
  private seq: number | null = null
  private stopped = false
  private attempt = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private renewTimer: ReturnType<typeof setInterval> | null = null
  private pendingPongs = 0
  private pending = new Map<string, { res: (v: { claimId?: string; denied?: { reason: string; holder?: unknown } }) => void }>()
  myClaimId: string | null = null
  private curTimer: ReturnType<typeof setTimeout> | null = null
  private lastCursor: { r: number; c: number } | null = null
  private lastCursorSent = 0
  onClaimLost: (() => void) | null = null
  private cursorNotify = false

  constructor(readonly fileId: number, readonly selfId: number) {
    document.addEventListener('visibilitychange', this.onVis)
  }
  subscribeMeta = (f: () => void) => { this.metaL.add(f); return () => { this.metaL.delete(f) } }
  subscribeCursors = (f: () => void) => { this.curL.add(f); return () => { this.curL.delete(f) } }
  getMeta = () => this.metaVersion
  getCursors = () => this.cursorVersion
  private bumpMeta() { this.metaVersion++; this.metaL.forEach((f) => f()) }
  private bumpCursors() {
    if (this.cursorNotify) return
    this.cursorNotify = true
    requestAnimationFrame(() => { this.cursorNotify = false; this.cursorVersion++; this.curL.forEach((f) => f()) })
  }
  private setStatus(s: FloorStatus, msg = '') { this.status = s; this.statusMsg = msg; this.bumpMeta() }
  private onVis = () => { if (document.hidden && this.curTimer) { clearTimeout(this.curTimer); this.curTimer = null } }

  start() { this.stopped = false; void this.connect() }

  private async connect() {
    if (this.stopped) return
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting')
    try {
      const t = await api<{ ticket: string }>('/floor/tickets', { method: 'POST', body: { fileId: this.fileId }, retries: 1 })
      if (this.stopped) return
      const ws = new WebSocket(`${env.ws}/floor/ws?ticket=${encodeURIComponent(t.ticket)}`)
      this.ws = ws
      ws.onopen = () => { this.attempt = 0; this.pendingPongs = 0; this.setStatus('open'); this.startPing() }
      ws.onmessage = (ev) => { try { this.handle(JSON.parse(String(ev.data)) as Msg) } catch { /* ignorar */ } }
      ws.onclose = (ev) => this.onClose(ev)
      ws.onerror = () => undefined
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'CLEARANCE_REQUIRED') return this.setStatus('closed', CLOSE_TEXT[4423])
      this.schedule(this.backoff())
    }
  }
  private backoff() { return Math.min(1000 * 2 ** this.attempt++, 20_000) + Math.random() * 400 }
  private schedule(ms: number) {
    if (this.stopped) return
    this.setStatus('reconnecting')
    this.timers.push(setTimeout(() => void this.connect(), ms))
  }
  private onClose(ev: CloseEvent) {
    this.stopTimers(); this.ws = null
    this.members.clear(); this.claims.clear(); this.cursors.clear(); this.seq = null
    for (const p of this.pending.values()) p.res({ denied: { reason: 'DISCONNECTED' } })
    this.pending.clear()
    if (this.myClaimId) { this.myClaimId = null; this.onClaimLost?.() }
    this.bumpMeta(); this.bumpCursors()
    if (this.stopped) return
    if (FINAL.has(ev.code)) return this.setStatus('closed', CLOSE_TEXT[ev.code] ?? 'Conexión cerrada.')
    if (ev.code === 4401) {
      if (this.attempt++ > 0) return this.setStatus('closed', 'El ticket del piso fue rechazado dos veces.')
      return void this.connect()
    }
    if (ev.code === 4429) return this.schedule(10_000 + Math.random() * 1000)
    this.schedule(this.backoff())
  }
  private startPing() {
    this.pingTimer = setInterval(() => {
      if (this.pendingPongs >= 2) { this.ws?.close(); return }
      this.pendingPongs++
      this.send({ type: 'ping', t: Date.now() })
    }, 15_000)
  }
  private stopTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.pingTimer = this.renewTimer = null
  }
  private send(m: Msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)) }
  get available() { return this.status === 'open' }

  private handle(m: Msg) {
    const seq = typeof m.seq === 'number' ? m.seq : null
    if (seq !== null && m.type !== 'snapshot') {
      if (this.seq !== null && seq <= this.seq) return
      if (this.seq !== null && seq > this.seq + 1) { this.send({ type: 'resync' }); return }
      this.seq = seq
    }
    switch (m.type) {
      case 'snapshot': {
        this.seq = seq
        this.members.clear(); this.claims.clear()
        for (const x of (m.members as Member[] | undefined) ?? []) this.members.set(x.userId, x)
        const cl = m.claims as Claim[] | undefined
        for (const x of cl ?? []) this.claims.set(x.claimId, x)
        this.cursors.clear(); this.bumpMeta(); this.bumpCursors(); break
      }
      case 'member.joined': this.members.set(m.userId as number, { userId: m.userId as number, displayName: m.displayName as string }); this.bumpMeta(); break
      case 'member.left': this.members.delete(m.userId as number); this.cursors.delete(m.userId as number); this.bumpMeta(); this.bumpCursors(); break
      case 'cursor': if (m.userId !== this.selfId) { this.cursors.set(m.userId as number, { r: m.r as number, c: m.c as number }); this.bumpCursors() } break
      case 'claim.granted': {
        const id = m.claimId as string
        this.claims.set(id, { claimId: id, userId: this.selfId, cells: m.cells as Claim['cells'], expiresAt: m.expiresAt as string })
        this.myClaimId = id
        this.pending.get(m.requestId as string)?.res({ claimId: id }); this.pending.delete(m.requestId as string)
        if (!this.renewTimer) this.renewTimer = setInterval(() => { if (this.myClaimId) this.send({ type: 'renew', claimId: this.myClaimId }) }, 5000)
        this.bumpMeta(); break
      }
      case 'claim.denied':
        this.pending.get(m.requestId as string)?.res({ denied: { reason: m.reason as string, holder: m.holder } }); this.pending.delete(m.requestId as string); break
      case 'claim.updated': this.claims.set(m.claimId as string, { claimId: m.claimId as string, userId: m.userId as number, cells: m.cells as Claim['cells'], expiresAt: m.expiresAt as string }); this.bumpMeta(); break
      case 'claim.released':
        this.claims.delete(m.claimId as string)
        if (m.claimId === this.myClaimId) { this.myClaimId = null; this.onClaimLost?.() }
        this.bumpMeta(); break
      case 'pong': this.pendingPongs = 0; break
    }
  }

  claim(r: number, c: number): Promise<{ claimId?: string; denied?: { reason: string; holder?: unknown } }> {
    if (!this.available) return Promise.resolve({})
    const requestId = crypto.randomUUID()
    return new Promise((res) => {
      this.pending.set(requestId, { res })
      this.send({ type: 'claim', requestId, r, c })
      setTimeout(() => { if (this.pending.delete(requestId)) res({ denied: { reason: 'TIMEOUT' } }) }, 5000)
    })
  }
  release() {
    if (this.myClaimId) this.send({ type: 'release', claimId: this.myClaimId })
    if (this.myClaimId) this.claims.delete(this.myClaimId)
    this.myClaimId = null; this.bumpMeta()
  }
  claimedByOther(cells: { r: number; c: number }[]): Claim | null {
    const want = new Set(cells.map((x) => `${x.r},${x.c}`))
    for (const cl of this.claims.values()) if (cl.userId !== this.selfId && cl.cells.some((x) => want.has(`${x.r},${x.c}`))) return cl
    return null
  }
  /** Máximo 10 por segundo; sin envío si la pestaña está oculta. */
  moveCursor(r: number, c: number) {
    this.lastCursor = { r, c }
    if (document.hidden || this.curTimer) return
    const wait = Math.max(0, 100 - (Date.now() - this.lastCursorSent))
    this.curTimer = setTimeout(() => {
      this.curTimer = null
      if (document.hidden || !this.lastCursor) return
      this.lastCursorSent = Date.now(); this.send({ type: 'cursor', ...this.lastCursor })
    }, wait)
  }
  stop() {
    this.stopped = true; this.release()
    this.timers.forEach(clearTimeout); this.stopTimers()
    if (this.curTimer) clearTimeout(this.curTimer)
    document.removeEventListener('visibilitychange', this.onVis)
    this.ws?.close(1000); this.ws = null; this.setStatus('idle')
  }
}
