import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', background: '#1a0000', color: '#ff6666', minHeight: '100vh' }}>
          <h2>⚠ Zenith 起動エラー</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{String(this.state.error)}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#ff9999' }}>{this.state.error?.stack}</pre>
          <button onClick={() => { localStorage.clear(); location.reload(); }}
            style={{ marginTop: 20, padding: '10px 20px', background: '#cc0000', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
            🔄 データをリセットして再起動
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
