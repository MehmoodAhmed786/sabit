import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; error?: Error }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(_error: Error, _info: React.ErrorInfo) {
    // Could log to remote error service here
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff6f6', padding: 12, borderRadius: 8 }}>{String(this.state.error)}</pre>
          <p>Open the browser console and the dev server terminal for details.</p>
        </div>
      )
    }
    return this.props.children
  }
}
