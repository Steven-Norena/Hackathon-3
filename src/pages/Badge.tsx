import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiFull, ApiError } from '../lib/api'
import { cropBadge, loadBitmap } from '../lib/image'
import { uploadImage } from '../lib/upload'
import { noteVersion } from '../lib/refiners'
import type { Refiner } from '../lib/types'

const BOX = 320

export function BadgeEditor() {
  const { id } = useParams()
  const [bmp, setBmp] = useState<ImageBitmap | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [state, setState] = useState<'idle' | 'working' | 'error' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [badge, setBadge] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => { void api<Refiner>(`/refiners/${id}`).then((r) => setBadge(r.badgeUrl ?? null)).catch(() => undefined) }, [id])

  const base = bmp ? BOX / Math.min(bmp.width, bmp.height) : 1
  const scale = base * zoom
  const clamp = useCallback((o: { x: number; y: number }, z = zoom) => {
    if (!bmp) return o
    const s = base * z
    const minX = BOX - bmp.width * s, minY = BOX - bmp.height * s
    return { x: Math.min(0, Math.max(minX, o.x)), y: Math.min(0, Math.max(minY, o.y)) }
  }, [bmp, base, zoom])

  const choose = async (f: File | undefined | null) => {
    if (!f) return
    setErr(null); setState('idle')
    try {
      const b = await loadBitmap(f)
      setBmp(b); setZoom(1); setSrc(URL.createObjectURL(f))
      const s = BOX / Math.min(b.width, b.height)
      setOff({ x: (BOX - b.width * s) / 2, y: (BOX - b.height * s) / 2 })
    } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) void choose(f) }
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste)
  }, [])

  const setZ = (z: number) => {
    if (!bmp) return
    z = Math.min(4, Math.max(1, z))
    const cx = (BOX / 2 - off.x) / scale, cy = (BOX / 2 - off.y) / scale
    const s2 = base * z
    setZoom(z); setOff(clamp({ x: BOX / 2 - cx * s2, y: BOX / 2 - cy * s2 }, z))
  }

  const save = async () => {
    if (!bmp) return
    setState('working'); setErr(null); setProgress(0)
    const c = new AbortController(); ctl.current = c
    try {
      const side = BOX / scale
      const prepared = await cropBadge(bmp, -off.x / scale, -off.y / scale, side)
      const mediaId = await uploadImage('BADGE', prepared, setProgress, c.signal)
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await apiFull<Refiner>(`/refiners/${id}`)
        const etag = cur.headers.get('ETag'); if (!etag) throw new Error('Falta la versión del expediente.')
        try {
          const { data } = await apiFull<Refiner>(`/refiners/${id}`, { method: 'PATCH', body: { badgeMediaId: mediaId }, headers: { 'If-Match': etag } })
          noteVersion(data.id, data.version); setBadge(data.badgeUrl ?? null); setState('done'); return
        } catch (e) { if (!(e instanceof ApiError && e.status === 412 && attempt === 0)) throw e }
      }
    } catch (e) {
      setState('error'); setErr((e as Error).name === 'AbortError' ? 'Subida cancelada.' : (e as Error).message)
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-3 p-4">
      <h1 className="font-display text-2xl">Fotocheck</h1>
      {badge && <img src={badge} alt="Fotocheck actual" width={96} height={96} className="h-24 w-24 rounded object-cover" />}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void choose(e.dataTransfer.files[0]) }} className="card border-dashed text-center">
        <p className="text-sm">Arrastra una imagen aquí, pégala (Ctrl+V) o elígela.</p>
        <input aria-label="Elegir imagen" className="mt-2 text-sm" type="file" accept="image/*" onChange={(e) => void choose(e.target.files?.[0])} />
      </div>
      {bmp && src && (
        <>
          <div role="application" tabIndex={0} aria-label="Recorte cuadrado. Flechas para mover, más y menos para el zoom." className="relative touch-none overflow-hidden rounded border-2 border-teal" style={{ width: BOX, height: BOX }}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y } }}
            onPointerMove={(e) => { if (drag.current) setOff(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })) }}
            onPointerUp={() => { drag.current = null }}
            onKeyDown={(e) => {
              const step = 10
              const d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
              if (d[e.key]) { e.preventDefault(); setOff(clamp({ x: off.x + d[e.key][0], y: off.y + d[e.key][1] })) }
              if (e.key === '+' || e.key === '=') setZ(zoom + 0.1); if (e.key === '-') setZ(zoom - 0.1)
            }}>
            <img src={src} alt="" draggable={false} className="absolute max-w-none select-none" style={{ left: off.x, top: off.y, width: bmp.width * scale, height: bmp.height * scale }} />
          </div>
          <label className="block text-sm">Zoom
            <input className="w-full" type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZ(Number(e.target.value))} />
          </label>
          {state === 'working' && (
            <div><div role="progressbar" aria-label="Subida del fotocheck" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 rounded bg-white"><div className="h-2 rounded bg-teal" style={{ width: `${progress}%` }} /></div>
              <button className="btn-ghost mt-2" onClick={() => ctl.current?.abort()}>Cancelar</button></div>
          )}
          <div className="flex gap-2">
            <button className="btn" disabled={state === 'working'} onClick={() => void save()}>{state === 'error' ? 'Reintentar' : 'Guardar fotocheck'}</button>
            <Link className="btn-ghost" to="/refiners">Volver</Link>
          </div>
        </>
      )}
      {err && <p role="alert" className="text-alarm">{err}</p>}
      {state === 'done' && <p role="status" className="text-teal">Fotocheck actualizado.</p>}
    </main>
  )
}
