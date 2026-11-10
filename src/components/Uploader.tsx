import { useCallback, useEffect, useRef, useState } from 'react'
import { fitIncident, loadBitmap } from '../lib/image'
import { uploadImage, type Prepared } from '../lib/upload'

export interface Item { id: string; name: string; preview: string; status: 'preparing' | 'uploading' | 'done' | 'error'; progress: number; error?: string; mediaId?: number }

/** Fotos de incidencia: subida en paralelo, cada una con progreso, cancelar y reintentar. */
export function useIncidentPhotos(max = 3) {
  const [items, setItems] = useState<Item[]>([])
  const ctl = useRef(new Map<string, AbortController>())
  const prepared = useRef(new Map<string, Prepared>())
  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const run = useCallback(async (id: string) => {
    const c = new AbortController(); ctl.current.set(id, c)
    patch(id, { status: 'uploading', progress: 0, error: undefined })
    try {
      const p = prepared.current.get(id)!
      const mediaId = await uploadImage('INCIDENT', p, (n) => patch(id, { progress: n }), c.signal)
      patch(id, { status: 'done', progress: 100, mediaId })
    } catch (e) {
      patch(id, { status: 'error', error: (e as Error).name === 'AbortError' ? 'Subida cancelada.' : (e as Error).message })
    } finally { ctl.current.delete(id) }
  }, [])

  const add = useCallback(async (files: File[]) => {
    const room = max - items.length
    for (const f of files.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID()
      setItems((cur) => [...cur, { id, name: f.name, preview: URL.createObjectURL(f), status: 'preparing', progress: 0 }])
      try {
        const bmp = await loadBitmap(f)
        prepared.current.set(id, await fitIncident(bmp)); bmp.close()
        void run(id)
      } catch (e) { patch(id, { status: 'error', error: (e as Error).message }) }
    }
  }, [items.length, max, run])

  const cancel = (id: string) => ctl.current.get(id)?.abort()
  const retry = (id: string) => { if (prepared.current.has(id)) void run(id) }
  const remove = (id: string) => { cancel(id); prepared.current.delete(id); setItems((cur) => cur.filter((x) => x.id !== id)) }
  useEffect(() => () => { ctl.current.forEach((c) => c.abort()) }, [])
  return { items, add, cancel, retry, remove, allDone: items.length > 0 && items.every((i) => i.status === 'done') }
}

export function PhotoList({ items, cancel, retry, remove }: Pick<ReturnType<typeof useIncidentPhotos>, 'items' | 'cancel' | 'retry' | 'remove'>) {
  return (
    <ul className="grid gap-2">
      {items.map((i) => (
        <li key={i.id} className="card flex items-center gap-3">
          <img src={i.preview} alt={`Vista previa de ${i.name}`} width={64} height={64} className="h-16 w-16 rounded object-cover" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate">{i.name}</p>
            {i.status === 'uploading' && <div role="progressbar" aria-label={`Subida de ${i.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.progress} className="h-2 rounded bg-white"><div className="h-2 rounded bg-teal" style={{ width: `${i.progress}%` }} /></div>}
            {i.status === 'preparing' && <p>Preparando…</p>}
            {i.status === 'done' && <p className="text-teal">Confirmada</p>}
            {i.status === 'error' && <p role="alert" className="text-alarm">{i.error}</p>}
          </div>
          {i.status === 'uploading' && <button type="button" className="btn-ghost" onClick={() => cancel(i.id)}>Cancelar</button>}
          {i.status === 'error' && <button type="button" className="btn-ghost" onClick={() => retry(i.id)}>Reintentar</button>}
          <button type="button" className="btn-ghost" onClick={() => remove(i.id)} aria-label={`Quitar ${i.name}`}>Quitar</button>
        </li>
      ))}
    </ul>
  )
}
