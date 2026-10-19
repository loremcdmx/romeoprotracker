import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { usePostsData } from './usePostsData.js'
import { fetchPublicData } from '../storage.js'
import App from '../App.jsx'
import { translate } from '../i18n.js'

vi.mock('../storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const payload = {
  posts: [{ id: 'p1', author: 'Romeopro', text: 'Day 1', likes: 5, timestamp: 1712500000, brAfter: 11000, images: [] }],
  meta: { startBankroll: 10000, totalTournaments: 40509, bankroll: 11000, brHistory: [] },
}

function Probe() {
  const { loading, error, posts, refresh } = usePostsData()
  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error?.message || ''}</output>
      <output data-testid="posts">{posts.length}</output>
      <button onClick={() => refresh().catch(() => {})}>refresh</button>
    </div>
  )
}

describe('retry after a failed initial load', () => {
  beforeEach(() => {
    fetchPublicData.mockReset()
    localStorage.clear()
  })

  it('goes back to loading while the retry is in flight', async () => {
    let finishRetry
    fetchPublicData
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('offline'))
    expect(screen.getByTestId('loading')).toHaveTextContent('false')

    fireEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('true'))
    expect(screen.getByTestId('error')).toHaveTextContent('')

    await act(async () => { finishRetry(payload) })
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('posts')).toHaveTextContent('1')
  })

  it('does not blank a dashboard that is already loaded on a manual refresh', async () => {
    let finishRefresh
    fetchPublicData
      .mockResolvedValueOnce(payload)
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('posts')).toHaveTextContent('1'))

    fireEvent.click(screen.getByText('refresh'))

    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    await act(async () => { finishRefresh(payload) })
  })

  it('App shows the loading message, not an empty zeroed dashboard, while retrying', async () => {
    fetchPublicData
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(() => {}))
    const { container } = render(<App />)
    fireEvent.click(await screen.findByText(translate('ru', 'retry')))

    await waitFor(() => expect(container.querySelector('.loading')).toHaveTextContent(translate('ru', 'loading')))
    expect(container.querySelector('main.page')).toBeNull()
    expect(container.textContent).not.toMatch(/3\s?565/)
  })
})

// A non-silent refresh that fails while the dashboard is already loaded must not
// replace it with the full error screen. The state is reached the way it can
// happen for real: the Retry request is still in flight when a silent poll
// (here: the tab becoming visible) delivers data, and then the Retry fails.
describe('a failed refresh while data is already on screen', () => {
  const t = (key, lang = 'ru') => translate(lang, key)
  const hasDashboard = (container) => container.querySelector('main.page') !== null

  async function reachDataPlusError(lang = 'ru') {
    localStorage.setItem('rpt_lang', lang)
    let failRetry
    fetchPublicData
      .mockRejectedValueOnce(new Error('offline'))                                              // initial load
      .mockImplementationOnce(() => new Promise((_, reject) => { failRetry = reject }))         // Retry, stays in flight
      .mockResolvedValueOnce(payload)                                                           // silent poll
    const view = render(<App />)
    fireEvent.click(await screen.findByText(t('retry', lang)))
    await waitFor(() => expect(view.container.querySelector('.loading')).not.toBeNull())
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { failRetry(new Error('still offline')) })
    return view
  }

  beforeEach(() => {
    fetchPublicData.mockReset()
    localStorage.clear()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  it('keeps the dashboard and shows an inline strip instead of the full error screen', async () => {
    const { container } = await reachDataPlusError()

    expect(screen.queryByText(t('load_failed_title'))).toBeNull()
    expect(hasDashboard(container)).toBe(true)
    const strip = screen.getByRole('alert')
    expect(strip).toHaveTextContent(t('refresh_failed'))
    expect(within(strip).getByText(t('retry'))).toBeInTheDocument()
  })

  it.each(['ru', 'en', 'es'])('the strip text exists in %s (not a raw key, not the Russian fallback elsewhere)', async (lang) => {
    await reachDataPlusError(lang)
    const text = screen.getByRole('alert').textContent
    expect(text).toContain(translate(lang, 'refresh_failed'))
    expect(translate(lang, 'refresh_failed')).not.toBe('refresh_failed')
    if (lang !== 'ru') expect(translate(lang, 'refresh_failed')).not.toBe(translate('ru', 'refresh_failed'))
  })

  it('Retry in the strip refreshes without blanking the page, and the strip goes away on success', async () => {
    const { container } = await reachDataPlusError()
    let finishRetry
    fetchPublicData.mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve }))

    fireEvent.click(within(screen.getByRole('alert')).getByText(t('retry')))

    // while it is in flight: still the dashboard, strip kept, button disabled
    expect(hasDashboard(container)).toBe(true)
    expect(container.querySelector('.loading')).toBeNull()
    expect(within(screen.getByRole('alert')).getByText(t('retry'))).toBeDisabled()

    await act(async () => { finishRetry(payload) })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(hasDashboard(container)).toBe(true)
  })

  it('a failed Retry in the strip keeps the dashboard and the strip', async () => {
    const { container } = await reachDataPlusError()
    fetchPublicData.mockRejectedValueOnce(new Error('offline again'))

    fireEvent.click(within(screen.getByRole('alert')).getByText(t('retry')))

    await waitFor(() => expect(within(screen.getByRole('alert')).getByText(t('retry'))).not.toBeDisabled())
    expect(hasDashboard(container)).toBe(true)
    expect(screen.queryByText(t('load_failed_title'))).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('the strip can be dismissed; the dashboard stays', async () => {
    const { container } = await reachDataPlusError()

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: t('close') }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(hasDashboard(container)).toBe(true)
  })

  it('dismissing while a Retry is in flight hides the strip at once; a failure of that Retry brings it back', async () => {
    const { container } = await reachDataPlusError()
    let failRetry
    fetchPublicData.mockImplementationOnce(() => new Promise((_, reject) => { failRetry = reject }))
    fireEvent.click(within(screen.getByRole('alert')).getByText(t('retry')))
    expect(within(screen.getByRole('alert')).getByText(t('retry'))).toBeDisabled()

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: t('close') }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hasDashboard(container)).toBe(true)

    await act(async () => { failRetry(new Error('failed after dismiss')) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByText(t('retry'))).not.toBeDisabled()
    expect(hasDashboard(container)).toBe(true)
  })

  it('the strip clears by itself when a later silent poll succeeds', async () => {
    await reachDataPlusError()
    fetchPublicData.mockResolvedValueOnce({ ...payload, posts: [...payload.posts] })

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('with nothing loaded the full error screen stays exactly as it was (no strip)', async () => {
    fetchPublicData
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline again'))
    const { container } = render(<App />)

    fireEvent.click(await screen.findByText(t('retry')))

    await waitFor(() => expect(container.querySelector('.loading')).toHaveTextContent(t('load_failed_title')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('main.page')).toBeNull()
    expect(screen.getByText(t('load_failed_body'))).toBeInTheDocument()
  })
})
