import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
