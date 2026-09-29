import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Friendly failure state instead of raw JavaScript errors. Retry re-mounts; Reload refetches failed chunks. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // keep details in the console for developers; students only see the friendly panel
    console.error('Experiment failed to render', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="state-screen" role="alert">
        <div className="state-card">
          <h2>Something went wrong loading this experiment.</h2>
          <p>Your wiring is saved for this session. Try again, or go back and reopen the lab.</p>
          <div className="state-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => this.setState({ failed: false })}
            >
              Retry
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export function LoadingScreen({ label = 'Loading Quantum Logic and Measurement Emulator…' }: { label?: string }) {
  return (
    <div className="state-screen" role="status" aria-live="polite">
      <div className="loader" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  )
}
