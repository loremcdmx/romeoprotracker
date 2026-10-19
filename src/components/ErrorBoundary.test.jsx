import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary.jsx'

function Bomb() {
  throw new Error('boom')
}

// React rethrows a caught render error through window 'error' in development,
// which jsdom would print as noise; the boundary has handled it by then.
const silenceWindowError = (event) => event.preventDefault()

describe('ErrorBoundary', () => {
  let errorSpy

  beforeEach(() => {
    localStorage.clear()
    // React and the boundary both report the caught error to the console.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.addEventListener('error', silenceWindowError)
  })

  afterEach(() => {
    window.removeEventListener('error', silenceWindowError)
    cleanup()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../App.jsx')
    document.body.innerHTML = ''
  })

  it('renders its children while nothing throws', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>)

    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a static ru/en fallback instead of a blank page when a child throws', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Что-то пошло не так')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: /Перезагрузить/ })).toBeInTheDocument()
    expect(errorSpy.mock.calls.some((call) => call.some((arg) => arg instanceof Error && arg.message === 'boom'))).toBe(true)
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('[romeo.fish] render failed'))).toBe(true)
  })

  it('reloads from the Reload button and keeps saved settings', () => {
    localStorage.setItem('rpt_fav_authors', '["TestUser"]')
    const onReload = vi.fn()
    render(<ErrorBoundary onReload={onReload}><Bomb /></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: /Перезагрузить/ }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('rpt_fav_authors')).toBe('["TestUser"]')
  })

  it('can reset the saved settings and cache before reloading', () => {
    localStorage.setItem('rpt_fav_authors', '["TestUser"]')
    localStorage.setItem('rpt_readpos', 'null')
    localStorage.setItem('rpt_cache_v8', '{}')
    localStorage.setItem('unrelated', 'keep')
    const onReload = vi.fn()
    render(<ErrorBoundary onReload={onReload}><Bomb /></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: /Сбросить настройки/ }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('rpt_fav_authors')).toBeNull()
    expect(localStorage.getItem('rpt_readpos')).toBeNull()
    expect(localStorage.getItem('rpt_cache_v8')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })

  it('still reloads when storage is blocked', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
    })
    try {
      const onReload = vi.fn()
      render(<ErrorBoundary onReload={onReload}><Bomb /></ErrorBoundary>)

      fireEvent.click(screen.getByRole('button', { name: /Сбросить настройки/ }))

      expect(onReload).toHaveBeenCalledTimes(1)
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  it('is wired around the app in main.jsx', async () => {
    vi.resetModules()
    vi.doMock('../App.jsx', () => ({ default: Bomb }))
    document.body.innerHTML = '<div id="root"></div>'

    await import('../main.jsx')

    await waitFor(() => expect(document.getElementById('root')).toHaveTextContent('Something went wrong'))
  })
})
