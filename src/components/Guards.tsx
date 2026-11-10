import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth'

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return <div role="status" className="p-8 text-center text-sm">{label}</div>
}

export function RequireAuth() {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'booting') return <Spinner label="Verificando sesión…" />
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search + loc.hash }} />
  return <Outlet />
}

export function RequirePerm({ perm, children }: { perm: string; children: JSX.Element }) {
  const { can, me } = useAuth()
  if (!me) return <Spinner />
  if (!can(perm)) return (
    <main className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-2xl">Sin permiso</h1>
      <p className="mt-2">Tu rol no incluye <code>{perm}</code>. Pide a supervisión que lo habilite.</p>
    </main>
  )
  return children
}

export function RequireClearance({ children }: { children: JSX.Element }) {
  const { me } = useAuth()
  if (!me) return <Spinner />
  if (!me.clearance.granted) return (
    <main className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-2xl">El Piso de Pruebas sigue cerrado</h1>
      <p className="mt-2">Corre la revisión automática desde <a className="underline" href="/estado">/estado</a> en la app desplegada.</p>
    </main>
  )
  return children
}
