import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, uuid } from '../lib/api'
import { useAuth } from '../context/Auth'
import { onEvent } from '../lib/events'
import { FloorClient, type Claim } from '../lib/floor'
import { BIN_LETTER, LETTER_BIN, TileStore, findGroup, groupBin, type Group } from '../lib/tiles'
import type { FileDetail, Progress, Rules } from '../lib/types'
import { Spinner } from '../components/Guards'

const CELL = 28
const MAX_DOM_CELLS = 2400
const BINS = ['WO', 'FC', 'DR', 'MA'] as const
const BIN_NAME: Record<string, string> = { WO: 'WO', FC: 'FC', DR: 'DR', MA: 'MA' }
const BIN_BG: Record<string, string> = { W: 'bg-sky-200', F: 'bg-amber-200', D: 'bg-rose-200', M: 'bg-violet-200' }

function binPercent(p: Progress | undefined, code: string): number {
  if (!p) return 0
  const cand = (p.bins as Record<string, unknown> | undefined)?.[code] ?? (p.byBin as Record<string, unknown> | undefined)?.[code] ?? p[code]
  if (typeof cand === 'number') return Math.min(100, cand <= 1 ? cand * 100 : cand)
  if (cand && typeof cand === 'object') {
    const o = cand as { total?: number; refined?: number; percent?: number; target?: number; done?: number }
    if (typeof o.percent === 'number') return o.percent
    const total = o.total ?? o.target, done = o.refined ?? o.done
    if (total && done !== undefined) return Math.min(100, (done / total) * 100)
  }
  return 0
}
function totalPercent(f: FileDetail | null): number {
  const p = f?.progress
  if (!p) return 0
  if (typeof p.percent === 'number') return p.percent
  if (p.total && p.refined !== undefined) return (p.refined / p.total) * 100
  return 0
}

interface Range { r0: number; r1: number; c0: number; c1: number }

export function RefinePage() {
  const { id } = useParams()
  const fileId = Number(id)
  const { me } = useAuth()
  const [file, setFile] = useState<FileDetail | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadFile = useCallback(async () => {
    const f = await api<FileDetail>(`/files/${fileId}`)
    setFile((prev) => ({ ...(prev ?? {}), ...f }))
  }, [fileId])

  useEffect(() => {
    let alive = true
    setFile(null); setRules(null); setError(null)
    Promise.all([api<FileDetail>(`/files/${fileId}`), api<Rules>(`/files/${fileId}/rules`)])
      .then(([f, r]) => { if (alive) { setFile(f); setRules(r) } })
      .catch((e: Error) => { if (alive) setError(e instanceof ApiError && e.status === 404 ? 'Este archivo no existe.' : e.message) })
    return () => { alive = false }
  }, [fileId])

  useEffect(() => onEvent('file.completed', (ev) => { if (Number(ev.data.fileId ?? ev.data.id) === fileId) void loadFile() }), [fileId, loadFile])

  if (!Number.isInteger(fileId)) return <p className="p-8">Archivo inválido.</p>
  if (error) return <main className="p-8 text-center"><p role="alert" className="text-alarm">{error}</p><Link className="btn mt-4" to="/files">Volver</Link></main>
  if (!file || !rules) return <Spinner label="Abriendo archivo…" />
  const done = totalPercent(file) >= 100 || /COMPLET/i.test(file.status ?? '')
  if (done) return (
    <main className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-3xl">Archivo completado</h1>
      <p className="mt-2">«{file.name}» está refinado al 100 %. Kier lo aprueba.</p>
      <Link className="btn mt-4" to="/files">Elegir otro archivo</Link>
    </main>
  )
  return <Workspace key={fileId} file={file} rules={rules} setFile={setFile} reload={loadFile} selfId={me?.user?.id ?? 0} granted={!!me?.clearance.granted} />
}

interface WProps { file: FileDetail; rules: Rules; setFile: (f: (p: FileDetail | null) => FileDetail | null) => void; reload: () => Promise<void>; selfId: number; granted: boolean }

function Workspace({ file, rules, setFile, reload, selfId, granted }: WProps) {
  const store = useMemo(() => new TileStore(file.id, file.tileSize), [file.id, file.tileSize])
  const floor = useMemo(() => (granted ? new FloorClient(file.id, selfId) : null), [file.id, selfId, granted])
  const [group, setGroup] = useState<Group | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const pending = useRef<{ sig: string; key: string } | null>(null)
  const selSeq = useRef(0)
  const range = useRef<Range>({ r0: 0, r1: 0, c0: 0, c1: 0 })

  useEffect(() => { floor?.start(); return () => floor?.stop() }, [floor])
  useEffect(() => () => store.dispose(), [store])
  useEffect(() => { if (floor) floor.onClaimLost = () => setMsg({ kind: 'info', text: 'Tu reserva se perdió. Vuelve a elegir el grupo.' }) }, [floor])

  // Eventos remotos: refinamientos de otros, sin recargar la grilla.
  useEffect(() => {
    const off1 = onEvent('refinement.created', (ev) => {
      const d = ev.data as { fileId?: number; cells?: { r: number; c: number }[]; bin?: string; progress?: Progress }
      if (Number(d.fileId) !== file.id || !d.cells || !d.bin) return
      store.applyBins(d.cells, BIN_LETTER[d.bin] ?? d.bin)
      if (d.progress) setFile((f) => (f ? { ...f, progress: d.progress } : f))
    })
    const off2 = onEvent('stream.reset', () => { store.invalidateAll(); void reload() })
    return () => { off1(); off2() }
  }, [file.id, store, setFile, reload])

  const activate = useCallback(async (r: number, c: number) => {
    const cell = store.cell(r, c)
    if (!cell || cell.tremor < rules.tremorThreshold) { setGroup(null); selSeq.current++; return }
    const my = ++selSeq.current
    setSelecting(true); setMsg(null)
    try {
      const g = await findGroup(store, rules, file.rows, file.cols, r, c, () => my === selSeq.current)
      if (g && my === selSeq.current) setGroup(g)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg({ kind: 'error', text: 'No se pudo cargar el grupo completo. Reintenta.' })
    } finally { if (my === selSeq.current) setSelecting(false) }
  }, [store, rules, file.rows, file.cols])

  const expected = group ? groupBin(rules, group) : null

  const refine = useCallback(async (bin: string) => {
    if (!group || busyRef.current) return
    if (!expected) { setMsg({ kind: 'error', text: group.complete ? `Este grupo es ruido: ${rules.minGroupSize}–${rules.maxGroupSize} celdas.` : 'Este grupo supera el tamaño máximo.' }); return }
    if (group.hasRefined) { setMsg({ kind: 'error', text: 'Alguna celda de este grupo ya fue refinada.' }); return }
    if (bin !== expected) { setMsg({ kind: 'error', text: `La caja correcta para este grupo es ${expected}, no ${bin}.` }); return }
    const other = floor?.claimedByOther(group.cells)
    if (other) { setMsg({ kind: 'error', text: 'Otro refinador tiene reservado este grupo.' }); return }
    busyRef.current = true; setBusy(true); setMsg(null)
    try {
      if (floor?.available) {
        const first = group.cells[0]
        const res = await floor.claim(first.r, first.c)
        if (res.denied) {
          const why = res.denied.reason === 'HELD' ? 'Otro refinador acaba de reservar este grupo.' : res.denied.reason === 'NOT_A_GROUP' ? 'La celda ya no pertenece a un grupo.' : 'No se pudo reservar el grupo. Inténtalo de nuevo.'
          setMsg({ kind: 'error', text: why }); return
        }
      }
      const sig = `${bin}:${group.cells.map((x) => `${x.r},${x.c}`).sort().join(';')}`
      if (!pending.current || pending.current.sig !== sig) pending.current = { sig, key: uuid() }
      const resp = await api<{ progress?: Progress } & Progress>(`/files/${file.id}/refinements`, {
        method: 'POST', body: { bin, cells: group.cells }, headers: { 'Idempotency-Key': pending.current.key },
      })
      pending.current = null
      store.applyBins(group.cells, BIN_LETTER[bin])
      const progress = (resp.progress ?? resp) as Progress
      setFile((f) => (f ? { ...f, progress } : f))
      setGroup(null); selSeq.current++
      setMsg({ kind: 'info', text: `Grupo refinado en ${bin}.` })
      if (totalPercent({ progress } as FileDetail) >= 100) void reload()
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status >= 400 && e.status < 500 && e.status !== 429) pending.current = null
        if (e.code === 'ALREADY_REFINED') { store.invalidate(group.cells); setGroup(null); setMsg({ kind: 'error', text: 'Alguien ya refinó una de esas celdas. Recargamos los bloques afectados.' }) }
        else if (e.code === 'GROUP_CLAIMED') setMsg({ kind: 'error', text: 'Otro refinador tiene reservado este grupo. Elige otro.' })
        else if (e.code === 'WRONG_BIN') setMsg({ kind: 'error', text: 'Esa no es la caja correcta. Se anotó un error de refinamiento.' })
        else if (e.status === 422) setMsg({ kind: 'error', text: `Grupo rechazado: ${(e.details as { reason?: string } | null)?.reason ?? e.message}` })
        else setMsg({ kind: 'error', text: e.message || 'Error al refinar. Puedes reintentar.' })
      } else setMsg({ kind: 'error', text: 'Error al refinar. Puedes reintentar.' })
    } finally { floor?.release(); busyRef.current = false; setBusy(false) }
  }, [group, expected, floor, rules, file.id, store, setFile, reload])

  // Arrastrar con Pointer Events (sin librería).
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const startDrag = useCallback((e: React.PointerEvent) => {
    if (!group || busyRef.current) return
    e.preventDefault()
    setDrag({ x: e.clientX, y: e.clientY })
    const move = (ev: PointerEvent) => setDrag({ x: ev.clientX, y: ev.clientY })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      setDrag(null)
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-bin]')
      if (el?.dataset.bin && ev.type === 'pointerup') void refine(el.dataset.bin)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }, [group, refine])

  const selection = useMemo(() => new Set((group?.cells ?? []).map((x) => x.r * file.cols + x.c)), [group, file.cols])

  return (
    <main className="grid gap-3 p-3 lg:grid-cols-[1fr_20rem]">
      <section aria-label={`Grilla de ${file.name}`}>
        <div className="mb-2 flex items-center justify-between">
          <h1 className="font-display text-2xl">{file.name}</h1>
          <Link to="/files" className="btn-ghost">Archivos</Link>
        </div>
        <VirtualGrid file={file} rules={rules} store={store} floor={floor} selection={selection} rangeRef={range} onActivate={activate} onPointerDownSelected={startDrag} />
      </section>
      <aside className="space-y-3" aria-label="Panel de refinamiento">
        <div className="card" aria-live="polite">
          <h2 className="font-display text-lg">Grupo seleccionado</h2>
          {selecting && <p>Buscando el grupo completo…</p>}
          {!selecting && !group && <p className="text-sm">Elige una celda que dé miedo (Enter o clic).</p>}
          {group && (
            <div className="space-y-1 text-sm">
              <p>Tamaño: <strong>{group.complete ? group.size : `más de ${group.size}`}</strong> celdas</p>
              <p>{expected ? <>Caja correcta: <strong>{expected}</strong></> : <strong className="text-alarm">Ruido: no se puede refinar</strong>}</p>
              {group.hasRefined && <p className="text-alarm">Ya tiene celdas refinadas.</p>}
              <div role="button" tabIndex={-1} onPointerDown={startDrag} className="mt-2 cursor-grab touch-none select-none rounded border border-dashed border-teal p-2 text-center">Arrastra el grupo a una caja</div>
            </div>
          )}
          {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.kind === 'error' ? 'text-alarm' : 'text-teal'}`}>{msg.text}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cajas">
          {BINS.map((b) => {
            const pct = binPercent(file.progress, b)
            return (
              <div key={b} data-bin={b} className={`card p-2 ${drag ? 'ring-2 ring-teal' : ''}`}>
                <button className="btn w-full" disabled={!group || busy || !expected} onClick={() => void refine(b)} aria-label={`Llevar el grupo a la caja ${BIN_NAME[b]}`}>{BIN_NAME[b]}</button>
                <div className="mt-2 h-2 rounded bg-white" role="progressbar" aria-label={`Progreso ${b}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><div className="h-2 rounded bg-teal" style={{ width: `${pct}%` }} /></div>
                <p className="text-xs">{Math.round(pct)} %</p>
              </div>
            )
          })}
        </div>
        {floor && <Presence floor={floor} />}
      </aside>
      {drag && <div className="pointer-events-none fixed z-50 rounded bg-teal px-2 py-1 text-xs text-white" style={{ left: drag.x + 8, top: drag.y + 8 }}>{group?.size} celdas</div>}
    </main>
  )
}

function Presence({ floor }: { floor: FloorClient }) {
  useSyncExternalStore(floor.subscribeMeta, floor.getMeta)
  useSyncExternalStore(floor.subscribeCursors, floor.getCursors)
  const members = [...floor.members.values()].filter((m) => m.userId !== floor.selfId)
  const goto = (userId: number) => {
    const cur = floor.cursors.get(userId); if (!cur) return
    const el = document.querySelector<HTMLElement>('[role="grid"]')
    el?.scrollTo({ top: Math.max(0, cur.r * CELL - 100), left: Math.max(0, cur.c * CELL - 100) })
  }
  return (
    <div className="card" aria-label="Refinadores en el piso">
      <h2 className="font-display text-lg">En el piso</h2>
      <p role="status" className={`text-xs ${floor.status === 'open' ? 'text-teal' : 'text-amber'}`}>
        ● {floor.status === 'open' ? 'Piso compartido conectado' : floor.status === 'closed' ? floor.statusMsg : floor.status === 'idle' ? 'Sin conexión' : 'Reconectando al piso…'}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {members.length === 0 && <li>Solo tú por ahora.</li>}
        {members.map((m) => {
          const cur = floor.cursors.get(m.userId)
          return <li key={m.userId} className="flex justify-between gap-2"><span>{m.displayName}</span>{cur && <button className="underline" onClick={() => goto(m.userId)}>ir ({cur.r},{cur.c})</button>}</li>
        })}
      </ul>
    </div>
  )
}

interface GProps {
  file: FileDetail; rules: Rules; store: TileStore; floor: FloorClient | null; selection: Set<number>
  rangeRef: React.MutableRefObject<Range>
  onActivate: (r: number, c: number) => void; onPointerDownSelected: (e: React.PointerEvent) => void
}

function VirtualGrid({ file, rules, store, floor, selection, rangeRef, onActivate, onPointerDownSelected }: GProps) {
  const { rows, cols } = file
  const ref = useRef<HTMLDivElement>(null)
  const [params, setParams] = useSearchParams()
  const initial = useRef({ r: Number(params.get('r')), c: Number(params.get('c')) })
  const [view, setView] = useState({ w: 800, h: 600 })
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [focus, setFocus] = useState({ r: 0, c: 0 })
  const focusWant = useRef(false)
  useSyncExternalStore(store.subscribe, store.getVersion)

  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setView({ w: el.clientWidth, h: el.clientHeight })
    const { r, c } = initial.current
    if (Number.isInteger(r) && Number.isInteger(c) && (r > 0 || c > 0)) {
      el.scrollTop = Math.min(Math.max(r, 0), rows - 1) * CELL; el.scrollLeft = Math.min(Math.max(c, 0), cols - 1) * CELL
      setFocus({ r: Math.min(Math.max(r, 0), rows - 1), c: Math.min(Math.max(c, 0), cols - 1) })
    }
    return () => ro.disconnect()
  }, [rows, cols])

  const raf = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout>>()
  const onScroll = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = ref.current; if (!el) return
      setPos((p) => (Math.floor(p.top / CELL) === Math.floor(el.scrollTop / CELL) && Math.floor(p.left / CELL) === Math.floor(el.scrollLeft / CELL) ? p : { top: el.scrollTop, left: el.scrollLeft }))
    })
    clearTimeout(idle.current)
    idle.current = setTimeout(() => {
      const el = ref.current; if (!el) return
      const r = Math.floor(el.scrollTop / CELL), c = Math.floor(el.scrollLeft / CELL)
      setParams((prev) => { const n = new URLSearchParams(prev); n.set('r', String(r)); n.set('c', String(c)); return n }, { replace: true })
    }, 400)
  }

  const range: Range = useMemo(() => {
    let r0 = Math.max(0, Math.floor(pos.top / CELL) - 1), c0 = Math.max(0, Math.floor(pos.left / CELL) - 1)
    let r1 = Math.min(rows - 1, Math.floor((pos.top + view.h) / CELL) + 1), c1 = Math.min(cols - 1, Math.floor((pos.left + view.w) / CELL) + 1)
    while ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_DOM_CELLS) { if (c1 - c0 > r1 - r0) c1--; else r1-- }
    return { r0, r1, c0, c1 }
  }, [pos, view, rows, cols])
  rangeRef.current = range

  // Pedir solo los bloques visibles; reintento periódico de los que fallaron.
  const needed = useMemo(() => {
    const out: [number, number][] = []
    const ts = file.tileSize
    for (let tr = Math.floor(range.r0 / ts); tr <= Math.floor(range.r1 / ts); tr++) for (let tc = Math.floor(range.c0 / ts); tc <= Math.floor(range.c1 / ts); tc++) out.push([tr, tc])
    return out
  }, [range, file.tileSize])
  useEffect(() => { store.setVisible(needed) }, [store, needed])
  useEffect(() => { const t = setInterval(() => store.setVisible(needed), 2500); return () => clearInterval(t) }, [store, needed])

  useEffect(() => {
    if (!focusWant.current) return
    focusWant.current = false
    ref.current?.querySelector<HTMLElement>(`[data-r="${focus.r}"][data-c="${focus.c}"]`)?.focus({ preventScroll: true })
  })

  const moveFocus = (r: number, c: number) => {
    r = Math.min(rows - 1, Math.max(0, r)); c = Math.min(cols - 1, Math.max(0, c))
    setFocus({ r, c }); focusWant.current = true
    const el = ref.current; if (!el) return
    if (r * CELL < el.scrollTop) el.scrollTop = r * CELL
    else if ((r + 1) * CELL > el.scrollTop + el.clientHeight) el.scrollTop = (r + 1) * CELL - el.clientHeight
    if (c * CELL < el.scrollLeft) el.scrollLeft = c * CELL
    else if ((c + 1) * CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = (c + 1) * CELL - el.clientWidth
  }
  const page = Math.max(1, Math.floor(view.h / CELL) - 1)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const { r, c } = focus
    const ctrl = e.ctrlKey || e.metaKey
    const map: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1],
      PageUp: [r - page, c], PageDown: [r + page, c], Home: ctrl ? [0, 0] : [r, 0], End: ctrl ? [rows - 1, cols - 1] : [r, cols - 1],
    }
    if (map[e.key]) { e.preventDefault(); moveFocus(...map[e.key]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) onActivate(r, c) }
  }
  const locate = (e: React.MouseEvent | React.PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
    return t ? { r: Number(t.dataset.r), c: Number(t.dataset.c) } : null
  }

  const rowsOut = []
  const cellEl = (r: number, c: number) => {
    const cell = store.cell(r, c)
    const sel = selection.has(r * cols + c)
    const scary = !!cell && cell.tremor >= rules.tremorThreshold
    const letter = cell && cell.bin !== '.' ? cell.bin : ''
    const cls = ['absolute grid place-items-center border border-line/40 text-xs select-none',
      !cell ? 'bg-mint/50' : letter ? BIN_BG[letter] ?? 'bg-white' : 'bg-white',
      scary && !letter ? 'scary text-alarm' : '', sel ? 'outline outline-2 outline-teal z-10' : ''].join(' ')
    const label = cell ? `Fila ${r + 1}, columna ${c + 1}, dígito ${cell.digit}${scary ? ', da miedo' : ''}${letter ? `, caja ${LETTER_BIN[letter]}` : ''}` : `Fila ${r + 1}, columna ${c + 1}, cargando`
    return (
      <div key={c} role="gridcell" aria-colindex={c + 1} aria-label={label} aria-selected={sel} data-r={r} data-c={c}
        tabIndex={focus.r === r && focus.c === c ? 0 : -1} className={cls}
        style={{ left: c * CELL, width: CELL, height: CELL, ...(scary && !letter ? ({ ['--tremble-speed' as string]: `${(0.55 - (cell!.tremor / 100) * 0.4).toFixed(2)}s` }) : {}) }}>
        {cell ? cell.digit : ''}{letter && <span className="sr-only">{LETTER_BIN[letter]}</span>}
      </div>
    )
  }
  const focusInRange = focus.r >= range.r0 && focus.r <= range.r1 && focus.c >= range.c0 && focus.c <= range.c1
  for (let r = range.r0; r <= range.r1; r++) {
    const cells = []
    for (let c = range.c0; c <= range.c1; c++) cells.push(cellEl(r, c))
    if (!focusInRange && r === focus.r) cells.push(cellEl(focus.r, focus.c))
    rowsOut.push(<div key={r} role="row" aria-rowindex={r + 1} className="absolute left-0" style={{ top: r * CELL, height: CELL, width: cols * CELL }}>{cells}</div>)
  }
  if (!focusInRange && focus.r < range.r0 || focus.r > range.r1) {
    if (!focusInRange) rowsOut.push(<div key="f" role="row" aria-rowindex={focus.r + 1} className="absolute left-0" style={{ top: focus.r * CELL, height: CELL, width: cols * CELL }}>{cellEl(focus.r, focus.c)}</div>)
  }

  return (
    <div ref={ref} role="grid" aria-label="Grilla de macrodatos" aria-rowcount={rows} aria-colcount={cols} aria-multiselectable="false"
      className="relative h-[70vh] overflow-auto rounded border border-line bg-white" onScroll={onScroll} onKeyDown={onKeyDown}
      onClick={(e) => { const p = locate(e); if (p) { setFocus(p); onActivate(p.r, p.c) } }}
      onPointerDown={(e) => { const p = locate(e); if (p && selection.has(p.r * cols + p.c)) onPointerDownSelected(e) }}
      onPointerMove={(e) => {
        if (!floor) return
        const el = ref.current; if (!el) return
        const b = el.getBoundingClientRect()
        floor.moveCursor(Math.min(rows - 1, Math.max(0, Math.floor((e.clientY - b.top + el.scrollTop) / CELL))), Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - b.left + el.scrollLeft) / CELL))))
      }}>
      <div style={{ width: cols * CELL, height: rows * CELL, position: 'relative' }}>
        {rowsOut}
        {floor && <RemoteLayer floor={floor} range={range} />}
      </div>
    </div>
  )
}

/** Cursores y reservas ajenas: se suscribe aparte, así no re-renderiza las celdas. */
const RemoteLayer = memo(function RemoteLayer({ floor, range }: { floor: FloorClient; range: Range }) {
  useSyncExternalStore(floor.subscribeCursors, floor.getCursors)
  useSyncExternalStore(floor.subscribeMeta, floor.getMeta)
  const inR = (r: number, c: number) => r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1
  const claims: Claim[] = [...floor.claims.values()].filter((x) => x.userId !== floor.selfId)
  return (
    <div className="pointer-events-none absolute inset-0">
      {claims.flatMap((cl) => cl.cells.filter((x) => inR(x.r, x.c)).map((x) => (
        <div key={`${cl.claimId}-${x.r}-${x.c}`} className="absolute border-2 border-dashed border-amber bg-amber/20" style={{ top: x.r * CELL, left: x.c * CELL, width: CELL, height: CELL }}
          title={`Reservado por ${floor.members.get(cl.userId)?.displayName ?? 'otro refinador'}`} />
      )))}
      {[...floor.cursors.entries()].filter(([, v]) => inR(v.r, v.c)).map(([uid, v]) => (
        <div key={uid} className="absolute z-20 rounded-sm bg-violet-600 px-1 text-[10px] text-white" style={{ top: v.r * CELL, left: v.c * CELL }}>{floor.members.get(uid)?.displayName.split(' ')[0] ?? '·'}</div>
      ))}
    </div>
  )
})
