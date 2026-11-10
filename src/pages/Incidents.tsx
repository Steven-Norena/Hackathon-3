import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLatestLoad } from '../lib/hooks'
import type { Incident, Page } from '../lib/types'
import { PhotoList, useIncidentPhotos } from '../components/Uploader'
import { Spinner } from '../components/Guards'

export function IncidentNew() {
  const nav = useNavigate()
  const photos = useIncidentPhotos(3)
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!photos.allDone) return
    setBusy(true); setErr(null)
    try {
      await api('/incidents', { method: 'POST', body: { title, description: desc, photoMediaIds: photos.items.map((i) => i.mediaId) } })
      nav('/incidents')
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="font-display text-2xl">Nueva incidencia</h1>
      <form onSubmit={(e) => void submit(e)} className="mt-3 grid gap-3">
        <label className="text-sm">Título<input className="field mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label className="text-sm">Descripción<textarea className="field mt-1" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} required /></label>
        <label className="text-sm">Fotos (1 a 3)
          <input className="mt-1 block" type="file" accept="image/*" multiple disabled={photos.items.length >= 3} onChange={(e) => { void photos.add([...(e.target.files ?? [])]); e.target.value = '' }} />
        </label>
        <PhotoList items={photos.items} cancel={photos.cancel} retry={photos.retry} remove={photos.remove} />
        {err && <p role="alert" className="text-alarm">{err}</p>}
        <button className="btn" disabled={busy || !photos.allDone || !title || !desc}>{busy ? 'Enviando…' : 'Enviar reporte'}</button>
        {!photos.allDone && <p className="text-xs">El reporte se habilita cuando todas las fotos estén confirmadas.</p>}
      </form>
    </main>
  )
}

export function IncidentsPage() {
  const { data, loading, error, reload } = useLatestLoad((s) => api<Page<Incident>>('/incidents?pageSize=50', { signal: s }), [])
  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="flex items-center justify-between"><h1 className="font-display text-3xl">Incidencias</h1><Link className="btn" to="/incidents/new">Nueva incidencia</Link></div>
      {loading && !data && <Spinner />}
      {error && <p role="alert" className="text-alarm">No se pudieron cargar. <button className="underline" onClick={reload}>Reintentar</button></p>}
      <ul className="mt-3 grid gap-2">
        {data?.items.map((i) => (
          <li key={i.id} className="card">
            <h2 className="font-medium">{i.title}</h2>
            <p className="whitespace-pre-wrap text-sm">{i.description}</p>
            <div className="mt-2 flex gap-2">{i.photos?.map((p) => <img key={p.mediaId} src={p.url} alt="Foto de la incidencia" width={96} height={96} loading="lazy" decoding="async" className="h-24 w-24 rounded object-cover" />)}</div>
          </li>
        ))}
      </ul>
    </main>
  )
}
