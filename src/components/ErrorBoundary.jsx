import { Component } from 'react'

// Last line of defence for the whole app: without a boundary any error thrown
// while rendering unmounts everything and leaves a blank page. The fallback is
// deliberately static (ru + en stacked, inline styles, no i18n state, no
// stylesheet classes) so it can still be shown when the app's own state is
// what broke.
const STORAGE_PREFIX = 'rpt_'

function reloadPage() {
  window.location.reload()
}

// Wipes saved preferences and the data cache. Only reachable from the fallback
// button, for the case where a stored value keeps crashing every reload.
function clearSavedSettings() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Storage may be blocked entirely; reloading is still worth trying.
  }
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    boxSizing: 'border-box',
    background: 'var(--bg, #111)',
    color: 'var(--text, #d4d4d4)',
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  card: {
    maxWidth: 440,
    width: '100%',
    padding: 24,
    boxSizing: 'border-box',
    textAlign: 'center',
    background: 'var(--bg2, #1a1a1a)',
    border: '1px solid var(--border, #2d2d2d)',
    borderRadius: 12,
  },
  title: { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--white, #f0f0f0)' },
  text: { margin: '0 0 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--dim2, #aaa)' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 },
  primary: {
    minHeight: 40,
    padding: '8px 18px',
    border: '1px solid var(--red, #e53935)',
    borderRadius: 8,
    background: 'var(--red, #e53935)',
    color: '#fff',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondary: {
    minHeight: 40,
    padding: '8px 18px',
    border: '1px solid var(--border2, #444)',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--dim2, #aaa)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
    this.handleReload = this.handleReload.bind(this)
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('[romeo.fish] render failed', error, info?.componentStack)
  }

  handleReload() {
    ;(this.props.onReload || reloadPage)()
  }

  handleReset() {
    clearSavedSettings()
    this.handleReload()
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div role="alert" style={styles.wrap} data-testid="error-boundary">
        <div style={styles.card}>
          <h1 style={styles.title}>Что-то пошло не так</h1>
          <p style={styles.text}>
            Страница не смогла отобразиться. Попробуйте перезагрузить её. Если ошибка повторяется,
            сбросьте сохранённые настройки.
          </p>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.text}>
            The page failed to render. Try reloading it. If the error keeps coming back,
            reset the saved settings.
          </p>
          <div style={styles.actions}>
            <button type="button" style={styles.primary} onClick={this.handleReload}>
              Перезагрузить / Reload
            </button>
            <button type="button" style={styles.secondary} onClick={this.handleReset}>
              Сбросить настройки / Reset settings
            </button>
          </div>
        </div>
      </div>
    )
  }
}
