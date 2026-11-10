import { api, ApiError } from './api'
import type { Rules, Tile } from './types'

export interface DecodedTile {
  tileRow: number; tileCol: number; originRow: number; originCol: number; rows: number; cols: number
  values: string; tremor: Uint8Array; bins: string[]; version: number
}
const key = (tr: number, tc: number) => `${tr}:${tc}`

function decode(t: Tile): DecodedTile {
  const bin = atob(t.tremor)
  const tremor = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) tremor[i] = bin.charCodeAt(i)
  return { tileRow: t.tileRow, tileCol: t.tileCol, originRow: t.originRow, originCol: t.originCol, rows: t.rows, cols: t.cols, values: t.values, tremor, bins: t.bins.split(''), version: t.version }
}

interface Inflight { ctl: AbortController; promise: Promise<void>; pinned: number }

/** Caché de bloques: sin duplicados en vuelo, cancelación fuera de vista, 429/503 manejados por api(). */
export class TileStore {
  private cache = new Map<string, DecodedTile>()
  private inflight = new Map<string, Inflight>()
  private listeners = new Set<() => void>()
  private queue: string[] = []
  private active = 0
  version = 0
  readonly fileId: number
  readonly tileSize: number
  requested = 0
  constructor(fileId: number, tileSize: number) { this.fileId = fileId; this.tileSize = tileSize }

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  getVersion = () => this.version
  private bump() { this.version++; this.listeners.forEach((f) => f()) }

  tileOf(r: number, c: number) { return { tr: Math.floor(r / this.tileSize), tc: Math.floor(c / this.tileSize) } }
  get(tr: number, tc: number) { return this.cache.get(key(tr, tc)) }
  cell(r: number, c: number): { digit: number; tremor: number; bin: string } | null {
    const { tr, tc } = this.tileOf(r, c)
    const t = this.cache.get(key(tr, tc))
    if (!t) return null
    const i = (r - t.originRow) * t.cols + (c - t.originCol)
    return { digit: t.values.charCodeAt(i) - 48, tremor: t.tremor[i] ?? 0, bin: t.bins[i] ?? '.' }
  }

  /** Bloques de la vista: se piden; los que ya no están en vista (y no están fijados) se cancelan. */
  setVisible(keys: [number, number][]) {
    const want = new Set(keys.map(([a, b]) => key(a, b)))
    for (const [k, inf] of this.inflight) if (!want.has(k) && inf.pinned === 0) { inf.ctl.abort(); this.inflight.delete(k) }
    this.queue = this.queue.filter((k) => want.has(k))
    for (const [a, b] of keys) this.request(a, b, false)
  }

  /** Necesario para un grupo que cruza bloques: no se cancela por scroll. */
  ensure(tr: number, tc: number): Promise<void> {
    if (this.cache.has(key(tr, tc))) return Promise.resolve()
    return this.request(tr, tc, true)
  }

  private request(tr: number, tc: number, pin: boolean): Promise<void> {
    const k = key(tr, tc)
    if (this.cache.has(k)) return Promise.resolve()
    const ex = this.inflight.get(k)
    if (ex) { if (pin) ex.pinned++; return ex.promise }
    const ctl = new AbortController()
    let resolve!: () => void, reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    promise.catch(() => undefined)
    const inf: Inflight = { ctl, promise, pinned: pin ? 1 : 0 }
    this.inflight.set(k, inf)
    const run = async () => {
      this.active++
      try {
        this.requested++
        const t = await api<Tile>(`/files/${this.fileId}/tiles/${tr}/${tc}`, { signal: ctl.signal, gate: true, retries: 5 })
        if (this.inflight.get(k) === inf) { this.cache.set(k, decode(t)); this.bump() }
        resolve()
      } catch (e) {
        reject(e)
      } finally {
        if (this.inflight.get(k) === inf) this.inflight.delete(k)
        this.active--; this.pump()
      }
    }
    ;(inf as Inflight & { run?: () => void }).run = () => { void run() }
    this.queue.push(k); this.pump()
    return promise
  }
  private pump() {
    while (this.active < 4 && this.queue.length) {
      const k = this.queue.shift()!
      const inf = this.inflight.get(k) as (Inflight & { run?: () => void }) | undefined
      if (inf?.run) { const r = inf.run; inf.run = undefined; r() }
    }
  }

  applyBins(cells: { r: number; c: number }[], letter: string) {
    for (const { r, c } of cells) {
      const { tr, tc } = this.tileOf(r, c)
      const t = this.cache.get(key(tr, tc))
      if (t) t.bins[(r - t.originRow) * t.cols + (c - t.originCol)] = letter
    }
    this.bump()
  }
  invalidate(cells: { r: number; c: number }[]) {
    for (const { r, c } of cells) { const { tr, tc } = this.tileOf(r, c); this.cache.delete(key(tr, tc)) }
    this.bump()
  }
  invalidateAll() { this.cache.clear(); this.bump() }
  dispose() { for (const i of this.inflight.values()) i.ctl.abort(); this.inflight.clear(); this.listeners.clear(); this.queue = [] }
}

export const BIN_LETTER: Record<string, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' }
export const LETTER_BIN: Record<string, string> = { W: 'WO', F: 'FC', D: 'DR', M: 'MA' }

export interface Group { cells: { r: number; c: number }[]; size: number; complete: boolean; hasRefined: boolean; digitSum: number; maxDigit: number }

/** Componente conexo máximo de celdas que dan miedo, pidiendo los bloques que falten. */
export async function findGroup(store: TileStore, rules: Rules, rows: number, cols: number, r0: number, c0: number, isCurrent: () => boolean): Promise<Group | null> {
  const neigh: [number, number][] = rules.connectivity === 8
    ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const seen = new Set<number>([r0 * cols + c0])
  const stack: [number, number][] = [[r0, c0]]
  const cells: { r: number; c: number }[] = []
  let sum = 0, max = 0, hasRefined = false
  const LIMIT = Math.max(rules.maxGroupSize * 4, 400)
  while (stack.length) {
    if (!isCurrent()) return null
    const [r, c] = stack.pop()!
    let cell = store.cell(r, c)
    if (!cell) { const { tr, tc } = store.tileOf(r, c); await store.ensure(tr, tc); cell = store.cell(r, c) }
    if (!cell || cell.tremor < rules.tremorThreshold) continue
    cells.push({ r, c }); sum += cell.digit; max = Math.max(max, cell.digit)
    if (cell.bin !== '.') hasRefined = true
    if (cells.length > LIMIT) return { cells, size: cells.length, complete: false, hasRefined, digitSum: sum, maxDigit: max }
    for (const [dr, dc] of neigh) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue
      const id = nr * cols + nc
      if (!seen.has(id)) { seen.add(id); stack.push([nr, nc]) }
    }
  }
  return { cells, size: cells.length, complete: true, hasRefined, digitSum: sum, maxDigit: max }
}

export function groupBin(rules: Rules, g: Group): string | null {
  if (!g.complete || g.size < rules.minGroupSize || g.size > rules.maxGroupSize) return null
  const v = rules.binning.strategy === 'DIGIT_SUM_MOD' ? g.digitSum : g.maxDigit
  return rules.binning.order[v % 4] ?? null
}
export { ApiError }
