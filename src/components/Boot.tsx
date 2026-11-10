import { useEffect, useState, type ReactNode } from 'react'
import { env } from '../lib/env'

/** Pantalla "Conectando con Lumon…" si /meta/health no responde. */
export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const r = await fetch(`${env.api}/meta/health`, { headers: { 'X-Lumon-Build': env.build } })
        if (!r.ok) throw new Error()
        if (!cancelled) setOk(true)
      } catch {
        if (cancelled) return
        setAttempt((a) => a + 1)
        timer = setTimeout(check, Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000))
      }
    }
    void check()
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  if (ok) return <>{children}</>
  return (
    <main role="status" className="grid min-h-screen place-items-center p-8 text-center">
      <div>
        <h1 className="font-display text-3xl">Conectando con Lumon…</h1>
        <p className="mt-2 text-sm">Intento {attempt + 1}. Reintentamos solos con espera creciente.</p>
        <button className="btn mt-4" onClick={() => { setAttempt(0); setTick((t) => t + 1) }}>Reintentar ahora</button>
      </div>
    </main>
  )
}
