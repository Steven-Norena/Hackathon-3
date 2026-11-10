import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './context/Auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HealthGate } from './components/Boot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HealthGate>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </HealthGate>
    </ErrorBoundary>
  </StrictMode>,
)
