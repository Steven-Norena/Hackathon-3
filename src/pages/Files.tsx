import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { intParam, useDebounced, useLatestLoad } from '../lib/hooks'
import { onEvent } from '../lib/events'
import type { FileSummary, Page } from '../lib/types'
import { Spinner } from '../components/Guards'

const STATUSES = ['', 'PENDING', 'IN_PROGRESS', 'COMPLETED']
const SORTS = ['name', '-name', 'progress', '-progress', 'id']
const SIZES = [10, 20, 50]

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Paginación" className="mt-3 flex items-center justify-center gap-3 text-sm">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page} de {Math.max(1, totalPages)}</span>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Siguiente</button>
    </nav>
  )
}

export function FilesPage() {
  const [sp, setSp] = useSearchParams()
  const page = intParam(sp.get('page'), 1, 1, 100000)
  const pageSize = SIZES.includes(Number(sp.get('pageSize'))) ? Number(sp.get('pageSize')) : 20
  const status = STATUSES.includes(sp.get('status') ?? '') ? sp.get('status') ?? '' : ''
  const sort = SORTS.includes(sp.get('sort') ?? '') ? sp.get('sort') ?? 'id' : 'id'
  const q = (sp.get('q') ?? '').slice(0, 80)
  const [text, setText] = useState(q)
  const debounced = useDebounced(text)
  useEffect(() => setText(q), [q])
  const set = (patch: Record<string, string | null>, resetPage = true) => setSp((prev) => {
    const n = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    if (resetPage) n.delete('page')
    return n
  })
  useEffect(() => { if (debounced !== q) set({ q: debounced || null }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debounced])

  const { data, loading, error, reload } = useLatestLoad(async (signal) => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
    if (status) qs.set('status', status); if (q) qs.set('q', q)
    return api<Page<FileSummary>>(`/files?${qs}`, { signal })
  }, [page, pageSize, status, sort, q])
  useEffect(() => onEvent('stream.reset', reload), [reload])

  const totalPages = data ? data.totalPages ?? Math.ceil(data.total / data.pageSize) : 1
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="font-display text-3xl">Archivos de datos</h1>
      <form className="my-3 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()} role="search">
        <label className="text-sm">Buscar<input className="field mt-1" type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label className="text-sm">Estado<select className="field mt-1" value={status} onChange={(e) => set({ status: e.target.value || null })}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'Todos'}</option>)}</select></label>
        <label className="text-sm">Orden<select className="field mt-1" value={sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm">Por página<select className="field mt-1" value={pageSize} onChange={(e) => set({ pageSize: e.target.value })}>{SIZES.map((s) => <option key={s}>{s}</option>)}</select></label>
      </form>
      {loading && !data && <Spinner />}
      {error && <p role="alert" className="text-alarm">No se pudieron cargar los archivos. <button className="underline" onClick={reload}>Reintentar</button></p>}
      {data && data.items.length === 0 && <p>No hay archivos con estos filtros.</p>}
      <ul className="grid gap-2" aria-busy={loading}>
        {data?.items.map((f) => (
          <li key={f.id} className="card flex items-center justify-between gap-3">
            <div><Link className="font-medium underline" to={`/files/${f.id}/refine`}>{f.name}</Link><p className="text-xs">{f.rows}×{f.cols} · {f.status}</p></div>
            <span className="text-sm">{Math.round((f.progress?.percent as number | undefined) ?? 0)} %</span>
          </li>
        ))}
      </ul>
      <Pager page={page} totalPages={totalPages} onPage={(p) => set({ page: String(p) }, false)} />
    </main>
  )
}
