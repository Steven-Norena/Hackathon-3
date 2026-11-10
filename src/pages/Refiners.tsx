import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, apiFull, ApiError } from '../lib/api'
import { intParam, useDebounced, useLatestLoad } from '../lib/hooks'
import { onEvent } from '../lib/events'
import { isStale, mergeRefiner, noteVersion } from '../lib/refiners'
import type { Department, Page, Refiner } from '../lib/types'
import { Spinner } from '../components/Guards'
import { Pager } from './Files'

const nameOf = (r: Refiner) => String(r.displayName ?? r.name ?? `#${r.id}`)

export function RefinersPage() {
  const [sp, setSp] = useSearchParams()
  const page = intParam(sp.get('page'), 1, 1, 100000)
  const dept = intParam(sp.get('departmentId'), 0, 0, 100000)
  const q = (sp.get('q') ?? '').slice(0, 80)
  const [text, setText] = useState(q); const d = useDebounced(text)
  useEffect(() => setText(q), [q])
  const set = (patch: Record<string, string | null>, reset = true) => setSp((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) } if (reset) n.delete('page'); return n })
  useEffect(() => { if (d !== q) set({ q: d || null }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d])
  const depts = useLatestLoad((s) => api<Department[] | { items: Department[] }>('/departments', { signal: s }), [])
  const deptList = Array.isArray(depts.data) ? depts.data : depts.data?.items ?? []
  const { data, setData, loading, error, reload } = useLatestLoad((signal) => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (dept) qs.set('departmentId', String(dept)); if (q) qs.set('q', q)
    return api<Page<Refiner>>(`/refiners?${qs}`, { signal })
  }, [page, dept, q])
  useEffect(() => {
    const a = onEvent('refiner.updated', (ev) => {
      const id = Number(ev.data.id)
      setData((cur) => cur && { ...cur, items: cur.items.map((r) => (r.id === id ? mergeRefiner(r, ev.data as Partial<Refiner>) : r)) })
    })
    const b = onEvent('stream.reset', reload)
    return () => { a(); b() }
  }, [setData, reload])
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="font-display text-3xl">Personal</h1>
      <form className="my-3 flex flex-wrap gap-3" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="text-sm">Buscar<input className="field mt-1" type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label className="text-sm">Departamento<select className="field mt-1" value={dept} onChange={(e) => set({ departmentId: e.target.value === '0' ? null : e.target.value })}><option value={0}>Todos</option>{deptList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </form>
      {loading && !data && <Spinner />}
      {error && <p role="alert" className="text-alarm">No se pudo cargar el directorio. <button className="underline" onClick={reload}>Reintentar</button></p>}
      <ul className="grid gap-2 sm:grid-cols-2" aria-busy={loading}>
        {data?.items.map((r) => (
          <li key={r.id} className="card flex gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-mint">
              {r.badgeUrl ? <img src={r.badgeUrl} alt={`Fotocheck de ${nameOf(r)}`} width={64} height={64} loading="lazy" decoding="async" className="h-16 w-16 object-cover" /> : <div className="grid h-16 w-16 place-items-center text-xs" aria-label="Sin fotocheck">Sin foto</div>}
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{nameOf(r)}</p>
              <p className="truncate">{String(r.title ?? '')} {r.department ? `· ${String(r.department)}` : ''}</p>
              <p className="mt-1 flex gap-3"><Link className="underline" to={`/refiners/${r.id}/badge`}>Fotocheck</Link><Link className="underline" to={`/refiners/${r.id}/edit`}>Editar</Link></p>
            </div>
          </li>
        ))}
      </ul>
      {data && <Pager page={page} totalPages={data.totalPages ?? Math.ceil(data.total / data.pageSize)} onPage={(p) => set({ page: String(p) }, false)} />}
    </main>
  )
}

const FIELDS = ['displayName', 'title', 'bio'] as const
type F = (typeof FIELDS)[number]
const LABELS: Record<F, string> = { displayName: 'Nombre', title: 'Cargo', bio: 'Biografía' }

export function RefinerEdit() {
  const { id } = useParams(); const nav = useNavigate()
  const [server, setServer] = useState<Refiner | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [form, setForm] = useState<Record<F, string>>({ displayName: '', title: '', bio: '' })
  const [dirty, setDirty] = useState(false)
  const [warn, setWarn] = useState(false)
  const [conflict, setConflict] = useState<{ current: Refiner; etag: string | null } | null>(null)
  const [choice, setChoice] = useState<Record<F, 'mine' | 'theirs'>>({ displayName: 'mine', title: 'mine', bio: 'mine' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toForm = (r: Refiner): Record<F, string> => ({ displayName: String(r.displayName ?? r.name ?? ''), title: String(r.title ?? ''), bio: String(r.bio ?? '') })

  useEffect(() => {
    let alive = true
    apiFull<Refiner>(`/refiners/${id}`).then(({ data, headers }) => {
      if (!alive) return
      noteVersion(data.id, data.version); setServer(data); setEtag(headers.get('ETag')); setForm(toForm(data))
    }).catch((e: Error) => alive && setErr(e.message))
    return () => { alive = false }
  }, [id])

  useEffect(() => onEvent('refiner.updated', (ev) => {
    if (Number(ev.data.id) !== Number(id) || isStale(Number(id), ev.data.version as number | undefined)) return
    noteVersion(Number(id), ev.data.version as number | undefined)
    if (dirty) setWarn(true)
    else setServer((s) => s && { ...s, ...(ev.data as Partial<Refiner>) })
  }), [id, dirty])

  const save = async (e?: FormEvent, withEtag = etag, body: Record<F, string> = form) => {
    e?.preventDefault()
    if (!withEtag) { setErr('Falta la versión del expediente. Recarga la página.'); return }
    setBusy(true); setErr(null)
    try {
      const { data, headers } = await apiFull<Refiner>(`/refiners/${id}`, { method: 'PATCH', body, headers: { 'If-Match': withEtag } })
      noteVersion(data.id, data.version); setServer(data); setEtag(headers.get('ETag') ?? withEtag); setDirty(false); setWarn(false); setConflict(null)
      nav('/refiners')
    } catch (x) {
      if (x instanceof ApiError && x.status === 412) {
        const cur = (x.details as { current?: Refiner } | null)?.current
        const fresh = cur ?? (await apiFull<Refiner>(`/refiners/${id}`)).data
        const hdr = (await apiFull<Refiner>(`/refiners/${id}`)).headers.get('ETag')
        setConflict({ current: fresh, etag: hdr })
      } else setErr((x as Error).message)
    } finally { setBusy(false) }
  }

  if (err && !server) return <p role="alert" className="p-8 text-alarm">{err}</p>
  if (!server) return <Spinner />

  if (conflict) {
    const theirs = toForm(conflict.current)
    return (
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="font-display text-2xl">Conflicto de versión</h1>
        <p className="mt-1 text-sm">Alguien cambió este expediente mientras lo editabas. Elige qué conservar en cada campo.</p>
        {FIELDS.map((f) => (
          <fieldset key={f} className="card mt-3"><legend className="px-1 font-medium">{LABELS[f]}</legend>
            <label className="block text-sm"><input type="radio" name={f} checked={choice[f] === 'mine'} onChange={() => setChoice({ ...choice, [f]: 'mine' })} /> Lo que escribiste: <span className="whitespace-pre-wrap">{form[f]}</span></label>
            <label className="block text-sm"><input type="radio" name={f} checked={choice[f] === 'theirs'} onChange={() => setChoice({ ...choice, [f]: 'theirs' })} /> Lo que hay ahora: <span className="whitespace-pre-wrap">{theirs[f]}</span></label>
          </fieldset>
        ))}
        {err && <p role="alert" className="mt-2 text-alarm">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button className="btn" disabled={busy} onClick={() => void save(undefined, conflict.etag, Object.fromEntries(FIELDS.map((f) => [f, choice[f] === 'mine' ? form[f] : theirs[f]])) as Record<F, string>)}>Guardar selección</button>
          <button className="btn-ghost" onClick={() => { setServer(conflict.current); setEtag(conflict.etag); setForm(theirs); setDirty(false); setConflict(null) }}>Descartar mis cambios</button>
        </div>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="font-display text-2xl">Editar expediente</h1>
      {warn && <p role="alert" className="card mt-2 border-amber">Este expediente cambió en el servidor mientras lo editabas. Si guardas, podrías ver un conflicto.</p>}
      <form onSubmit={(e) => void save(e)} className="mt-3 grid gap-3">
        {FIELDS.map((f) => (
          <label key={f} className="text-sm">{LABELS[f]}
            {f === 'bio' ? <textarea className="field mt-1" rows={4} value={form[f]} onChange={(e) => { setForm({ ...form, [f]: e.target.value }); setDirty(true) }} />
              : <input className="field mt-1" value={form[f]} onChange={(e) => { setForm({ ...form, [f]: e.target.value }); setDirty(true) }} />}
          </label>
        ))}
        {err && <p role="alert" className="text-alarm">{err}</p>}
        <div className="flex gap-2"><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><Link className="btn-ghost" to="/refiners">Cancelar</Link></div>
      </form>
    </main>
  )
}
