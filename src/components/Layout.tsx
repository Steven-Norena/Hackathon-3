import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/Auth'
import { getStreamStatus, onStreamStatus, type StreamStatus } from '../lib/events'
import { ContingencyModal } from './ContingencyModal'

const LABEL: Record<StreamStatus, string> = { idle: 'Sin conexión en vivo', connecting: 'Conectando…', open: 'En vivo', reconnecting: 'Reconectando…', stopped: 'En vivo pausado' }

export function Layout() {
  const { me, logout, can } = useAuth()
  const [s, setS] = useState(getStreamStatus())
  useEffect(() => onStreamStatus(setS), [])
  const link = ({ isActive }: { isActive: boolean }) => `px-2 py-1 rounded ${isActive ? 'bg-ink text-white' : 'hover:bg-panel'}`
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only">Saltar al contenido</a>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <Link to="/files" className="font-display text-lg">Lumon · MDR</Link>
        <nav aria-label="Principal" className="flex gap-1 text-sm">
          {can('files:read') && <NavLink className={link} to="/files">Archivos</NavLink>}
          {can('refiners:read') && <NavLink className={link} to="/refiners">Personal</NavLink>}
          {can('incidents:read') && <NavLink className={link} to="/incidents">Incidencias</NavLink>}
          <NavLink className={link} to="/estado">Estado</NavLink>
        </nav>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <span role="status" aria-live="polite" className={s === 'open' ? 'text-teal' : 'text-amber'}>● {LABEL[s]}</span>
          <span>{me?.team.code} · {me?.role.name}</span>
          <button className="btn-ghost" onClick={() => void logout()}>Cerrar sesión</button>
        </span>
      </header>
      <div id="main"><Outlet /></div>
      <ContingencyModal />
    </div>
  )
}
