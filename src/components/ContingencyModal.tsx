import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { onEvent } from '../lib/events'
import { useAuth } from '../context/Auth'

interface Contingency { id: number | string; message?: string; hours?: number }
const chan: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-contingency') : null

export function ContingencyModal() {
  const { me } = useAuth()
  const [c, setC] = useState<Contingency | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<Element | null>(null)

  useEffect(() => onEvent('contingency.activated', (ev) => {
    const d = ev.data as Record<string, unknown>
    const target = d.userId ?? d.targetUserId
    if (target !== undefined && me?.user && Number(target) !== me.user.id) return
    prevFocus.current = document.activeElement
    setC({ id: (d.id ?? d.contingencyId) as number | string, message: d.message as string | undefined, hours: d.hours as number | undefined })
  }), [me])

  useEffect(() => {
    const f = (m: MessageEvent<{ ack: number | string }>) => setC((cur) => (cur && cur.id === m.data.ack ? null : cur))
    chan?.addEventListener('message', f); return () => chan?.removeEventListener('message', f)
  }, [])

  useEffect(() => {
    if (!c) { (prevFocus.current as HTMLElement | null)?.focus?.(); return }
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return
      const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [c])

  if (!c) return null
  const ack = async () => {
    setBusy(true); setErr(null)
    try { await api(`/contingency/${c.id}/ack`, { method: 'POST' }); chan?.postMessage({ ack: c.id }); setC(null) }
    catch (e) { setErr((e as Error).message || 'No se pudo confirmar. Inténtalo de nuevo.') }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4">
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="ct-title" aria-describedby="ct-desc" className="card max-w-md bg-white">
        <h2 id="ct-title" className="font-display text-2xl">Contingencia activada</h2>
        <p id="ct-desc" className="mt-2">{c.message ?? 'Se activó una contingencia de horas extra para tu usuario.'}{c.hours ? ` (${c.hours} h)` : ''}</p>
        {err && <p role="alert" className="mt-2 text-alarm">{err}</p>}
        <button className="btn mt-4" onClick={ack} disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar contingencia'}</button>
      </div>
    </div>
  )
}
