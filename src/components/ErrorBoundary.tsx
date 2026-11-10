import { Component, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main role="alert" className="mx-auto max-w-lg p-8 text-center">
        <h1 className="font-display text-2xl">Algo falló en esta pantalla</h1>
        <p className="mt-2 text-sm">{this.state.error.message}</p>
        <button className="btn mt-4" onClick={() => { this.setState({ error: null }); window.location.assign('/files') }}>Volver a los archivos</button>
      </main>
    )
  }
}
