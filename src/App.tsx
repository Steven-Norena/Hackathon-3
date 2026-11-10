import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Login, NotFound, Register } from './pages/Auth'
import { Layout } from './components/Layout'
import { RequireAuth, RequireClearance, RequirePerm, Spinner } from './components/Guards'

const FilesPage = lazy(() => import('./pages/Files').then((m) => ({ default: m.FilesPage })))
const RefinePage = lazy(() => import('./pages/Refine').then((m) => ({ default: m.RefinePage })))
const RefinersPage = lazy(() => import('./pages/Refiners').then((m) => ({ default: m.RefinersPage })))
const RefinerEdit = lazy(() => import('./pages/Refiners').then((m) => ({ default: m.RefinerEdit })))
const BadgeEditor = lazy(() => import('./pages/Badge').then((m) => ({ default: m.BadgeEditor })))
const IncidentsPage = lazy(() => import('./pages/Incidents').then((m) => ({ default: m.IncidentsPage })))
const IncidentNew = lazy(() => import('./pages/Incidents').then((m) => ({ default: m.IncidentNew })))
const Estado = lazy(() => import('./pages/Estado').then((m) => ({ default: m.Estado })))

const gate = (perm: string, el: JSX.Element, floor = false) => (
  <RequirePerm perm={perm}>{floor ? <RequireClearance>{el}</RequireClearance> : el}</RequirePerm>
)

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/files" replace />} />
            <Route path="/files" element={gate('files:read', <FilesPage />)} />
            <Route path="/files/:id/refine" element={gate('files:refine', <RefinePage />)} />
            <Route path="/refiners" element={gate('refiners:read', <RefinersPage />, true)} />
            <Route path="/refiners/:id/badge" element={gate('refiners:write', <BadgeEditor />, true)} />
            <Route path="/refiners/:id/edit" element={gate('refiners:write', <RefinerEdit />, true)} />
            <Route path="/incidents" element={gate('incidents:read', <IncidentsPage />, true)} />
            <Route path="/incidents/new" element={gate('incidents:create', <IncidentNew />, true)} />
            <Route path="/estado" element={<Estado />} />
          </Layout>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
