import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, applySession, logout as apiLogout, login as apiLogin, register as apiRegister, onSessionLost, restoreSession, hasStoredRefresh } from '../lib/api'
import type { Me } from '../lib/types'
import { startEvents, stopEvents } from '../lib/events'

type Status = 'booting' | 'anon' | 'authed'
interface Ctx {
  status: Status; me: Me | null; notice: string | null
  can: (perm: string) => boolean
  login: (e: string, p: string) => Promise<void>
  register: (t: string, e: string, p: string) => Promise<void>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  clearNotice: () => void
}
const AuthCtx = createContext<Ctx | null>(null)
export const useAuth = () => { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider ausente'); return c }

const REASONS: Record<string, string> = {
  REFRESH_REUSED: 'Detectamos un uso repetido de tu sesión y la cerramos por seguridad. Inicia sesión de nuevo.',
  SESSION_REVOKED: 'Tu sesión fue revocada. Inicia sesión de nuevo.',
  TOKEN_INVALID: 'Tu sesión ya no es válida. Inicia sesión de nuevo.',
  EXPIRED: 'Tu sesión venció. Inicia sesión de nuevo.',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(hasStoredRefresh() ? 'booting' : 'anon')
  const [me, setMe] = useState<Me | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const booted = useRef(false)

  const reloadMe = useCallback(async () => { setMe(await api<Me>('/auth/me')) }, [])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (!hasStoredRefresh()) return
    void (async () => {
      try {
        if (await restoreSession()) { await reloadMe(); setStatus('authed') } else setStatus('anon')
      } catch { setStatus('anon') }
    })()
  }, [reloadMe])

  useEffect(() => onSessionLost((reason) => {
    setMe(null); setStatus('anon'); stopEvents()
    if (reason !== 'LOGOUT') setNotice(REASONS[reason] ?? REASONS.EXPIRED)
  }), [])

  useEffect(() => { if (status === 'authed') startEvents(); else stopEvents() }, [status])

  const value = useMemo<Ctx>(() => ({
    status, me, notice,
    can: (p) => !!me?.permissions.includes(p),
    login: async (e, p) => { await apiLogin(e, p); await reloadMe(); setNotice(null); setStatus('authed') },
    register: async (t, e, p) => { await apiRegister(t, e, p); await reloadMe(); setNotice(null); setStatus('authed') },
    logout: async () => { await apiLogout() },
    reloadMe, clearNotice: () => setNotice(null),
  }), [status, me, notice, reloadMe])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
export { ApiError, applySession }
