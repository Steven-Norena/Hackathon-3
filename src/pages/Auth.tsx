import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/Auth'
import { fieldErrors } from '../lib/hooks'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-4 p-6">
      <h1 className="font-display text-3xl">{title}</h1>
      {children}
    </main>
  )
}

function Field({ id, label, type = 'text', value, onChange, error, autoComplete }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; error?: string; autoComplete?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} className="field" type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} required />
      {error && <p id={`${id}-err`} className="mt-1 text-sm text-alarm">{error}</p>}
    </div>
  )
}

function useRedirectTarget() {
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/files'
}

export function Login() {
  const { login, status, notice, clearNotice } = useAuth()
  const nav = useNavigate()
  const to = useRedirectTarget()
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false)
  if (status === 'authed') return <Navigate to={to} replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setFe({}); clearNotice()
    try { await login(email, pw); nav(to, { replace: true }) }
    catch (x) { setFe(fieldErrors(x)); setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Entrar al piso">
      {notice && <p role="alert" className="card border-amber">{notice}</p>}
      <form onSubmit={submit} className="card grid gap-3">
        <Field id="email" label="Correo" type="email" value={email} onChange={setEmail} error={fe.email} autoComplete="email" />
        <Field id="password" label="Contraseña" type="password" value={pw} onChange={setPw} error={fe.password} autoComplete="current-password" />
        {err && !Object.keys(fe).length && <p role="alert" className="text-sm text-alarm">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="text-sm">¿Sin cuadrilla? <Link className="underline" to="/register">Registrar cuadrilla</Link></p>
    </Shell>
  )
}

export function Register() {
  const { register, status } = useAuth()
  const nav = useNavigate()
  const [team, setTeam] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false)
  if (status === 'authed') return <Navigate to="/files" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setFe({})
    try { await register(team, email, pw); nav('/files', { replace: true }) }
    catch (x) { setFe(fieldErrors(x)); setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Registrar cuadrilla">
      <form onSubmit={submit} className="card grid gap-3">
        <Field id="teamName" label="Nombre del equipo" value={team} onChange={setTeam} error={fe.teamName ?? fe.name} />
        <Field id="email" label="Correo" type="email" value={email} onChange={setEmail} error={fe.email} autoComplete="email" />
        <Field id="password" label="Contraseña" type="password" value={pw} onChange={setPw} error={fe.password} autoComplete="new-password" />
        {err && !Object.keys(fe).length && <p role="alert" className="text-sm text-alarm">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Registrando…' : 'Registrar y entrar'}</button>
      </form>
      <p className="text-sm">¿Ya tienes cuenta? <Link className="underline" to="/login">Entrar</Link></p>
    </Shell>
  )
}

export function NotFound() {
  return (
    <main className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-3xl">404</h1>
      <p className="mt-2">Esta puerta no existe en el piso.</p>
      <Link className="btn mt-4" to="/files">Volver a los archivos</Link>
    </main>
  )
}
