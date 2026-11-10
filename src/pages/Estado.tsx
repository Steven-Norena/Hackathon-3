import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { env } from '../lib/env'
import { useAuth } from '../context/Auth'
import { useLatestLoad } from '../lib/hooks'
import { Spinner } from '../components/Guards'

interface Check { name?: string; id?: string; passed: boolean; reason?: string; message?: string }
interface CheckResult { passed?: boolean; checks?: Check[] }

function Checks({ r }: { r: CheckResult | null }) {
  if (!r?.checks) return null
  return <ul className="mt-2 grid gap-1 text-sm">{r.checks.map((c, i) => (
    <li key={i} className={c.passed ? 'text-teal' : 'text-alarm'}>{c.passed ? '✔' : '✘'} {c.name ?? c.id}: {c.reason ?? c.message ?? ''}</li>
  ))}</ul>
}

export function Estado() {
  const { me, reloadMe } = useAuth()
  const health = useLatestLoad((s) => api<{ status?: string }>('/meta/health', { auth: false, signal: s, retries: 0 }), [])
  const integ = useLatestLoad((s) => api<Record<string, unknown>>('/integrations/status', { signal: s }), [])
  const clearance = useLatestLoad((s) => api<Record<string, unknown>>('/clearance', { signal: s }), [])
  const [res, setRes] = useState<CheckResult | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState<{ token?: string; path?: string } | null>(null)
  const [storageRes, setStorageRes] = useState<CheckResult | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg(e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message) } finally { setBusy(false) }
  }
  const openFloor = () => run(async () => {
    try { setRes(await api<CheckResult>('/clearance/check', { method: 'POST' })) }
    catch (e) { if (e instanceof ApiError && (e.details as { checks?: Check[] } | null)?.checks) setRes(e.details as CheckResult); throw e }
    await reloadMe(); clearance.reload()
  })

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="font-display text-3xl">Estado del servicio</h1>
      <section className="card" aria-label="Build y API">
        <p>Build desplegado: <code data-testid="build">{env.build}</code></p>
        <p>API: {health.loading ? 'comprobando…' : health.error ? <span className="text-alarm">no responde</span> : <span className="text-teal">responde</span>}</p>
        <p>Equipo: {me?.team.code} · Piso de Pruebas: <strong>{me?.clearance.granted ? 'abierto' : 'cerrado'}</strong></p>
      </section>
      <section className="card" aria-label="Revisión automática">
        <h2 className="font-display text-xl">Revisión automática</h2>
        <button className="btn mt-2" disabled={busy} onClick={() => void openFloor()}>{busy ? 'Revisando…' : 'Abrir el Piso de Pruebas'}</button>
        {msg && <p role="alert" className="mt-2 text-alarm">{msg}</p>}
        <Checks r={res} />
      </section>
      <section className="card" aria-label="Integraciones">
        <h2 className="font-display text-xl">Integraciones</h2>
        {integ.loading ? <Spinner /> : <pre className="overflow-auto text-xs">{JSON.stringify(integ.data, null, 2)}</pre>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => setChallenge(await api('/integrations/deploy/challenge', { method: 'POST', body: { origin: location.origin } })))}>1 · Pedir token de dominio</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => { await api('/integrations/deploy/verify', { method: 'POST' }); integ.reload() })}>3 · Verificar dominio</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => {
            const body = env.provider === 'cloudinary'
              ? { provider: 'cloudinary', cloudName: env.cloudName, uploadPreset: env.preset }
              : { provider: 'supabase', url: env.supabaseUrl, bucket: env.supabaseBucket, publishableKey: env.supabaseKey }
            setStorageRes(await api<CheckResult>('/integrations/storage', { method: 'PUT', body })); integ.reload()
          })}>Registrar storage</button>
        </div>
        {challenge && <p className="mt-2 text-sm">Publica este texto en <code>/.well-known/lumon-verification.txt</code>: <code className="break-all">{challenge.token}</code></p>}
        <Checks r={storageRes} />
      </section>
      <section className="card" aria-label="Modo caos">
        <h2 className="font-display text-xl">Modo caos</h2>
        <div className="mt-2 flex gap-2">{[0, 1, 2].map((l) => <button key={l} className="btn-ghost" disabled={busy} onClick={() => void run(async () => { await api('/workspace/chaos', { method: 'PUT', body: { level: l } }) })}>Nivel {l}</button>)}</div>
      </section>
    </main>
  )
}
