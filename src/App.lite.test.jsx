import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', async importOriginal => ({
  ...await importOriginal(), fetchPublicData:vi.fn(),
}))
vi.mock('@vercel/analytics/react', () => ({ Analytics:() => null }))
vi.mock('./hooks/useIsMobile.js', () => ({
  useIsMobile:(maxWidth = 720) => window.innerWidth <= maxWidth,
}))

function makeData() {
  const post = (id, timestamp, text, author = 'Romeopro') => ({
    id, timestamp, text, author, likes:10, rating:16000,
    images:[], url:`https://forum.gipsyteam.ru/test-${id}`,
  })
  const recentPosts = [
    post('recent-report', 1788062400, 'Свежий отчет'),
    post('recent-reply', 1788062500, 'Свежий ответ', 'TestUser'),
  ]
  const meta = {
    startBankroll:10000, bankroll:13000, day:3, totalPosts:325, totalTournaments:600,
    lastUpdated:'2026-08-30T00:00:00Z',
    brHistory:[
      { id:'march', timestamp:1773230400, brBefore:10000, brAfter:11000, tournaments:100, totalTournaments:100 },
      { id:'april', timestamp:1775908800, brBefore:11000, brAfter:12000, tournaments:200, totalTournaments:300 },
      { id:'august', timestamp:1788062400, brBefore:12000, brAfter:13000, tournaments:300, totalTournaments:600 },
    ],
  }
  return {
    recent:{ posts:recentPosts, meta, coverage:{ mode:'recent', limit:300, loadedPosts:2, totalPosts:325 } },
    full:{ posts:[post('archive', 1773230400, 'Архивное обсуждение'), ...recentPosts], meta,
      coverage:{ mode:'full', loadedPosts:3, totalPosts:325 } },
  }
}

describe('mobile light feed', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    Object.defineProperty(window, 'innerWidth', { configurable:true, value:390, writable:true })
    const data = makeData()
    fetchPublicData.mockImplementation(options => Promise.resolve(structuredClone(options?.mode === 'recent' ? data.recent : data.full)))
  })

  it('requests only recent posts on mobile while retaining the complete session charts', async () => {
    render(<App />)
    const notice = await screen.findByTestId('lite-feed-notice')
    expect(fetchPublicData).toHaveBeenCalledWith({ mode:'recent' })
    expect(fetchPublicData).toHaveBeenCalledTimes(1)
    expect(notice).toHaveTextContent('Последние 2 из 325 постов')
    expect(screen.getByTestId('session-mtt-widget').querySelectorAll('.smtt-bar')).toHaveLength(3)
    expect(screen.getByTestId('session-mtt-widget')).toHaveTextContent('3 сессии')
    expect(screen.queryByText('Архивное обсуждение')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name:'Активность постов' })).not.toBeInTheDocument()
    expect(screen.getByRole('search')).toHaveTextContent('только по загруженным свежим постам')
    expect(document.querySelector('.mobile-top-header')).toHaveTextContent('Топ свежих постов')
    expect(document.querySelector('.mobile-top-periods')).toBeNull()

    fireEvent.click(within(screen.getByTestId('session-mtt-widget')).getByRole('button', { name:'Месяц' }))
    expect(screen.getByTestId('session-mtt-widget').querySelectorAll('.smtt-bar')).toHaveLength(3)
    expect(fetchPublicData).toHaveBeenCalledTimes(1)
  })

  it('loads the archive only on request and then enables full search and activity without a new-post badge', async () => {
    render(<App />)
    await screen.findByTestId('lite-feed-notice')
    fireEvent.click(screen.getAllByRole('button', { name:'Загрузить всю историю' })[0])

    expect((await screen.findAllByText('Архивное обсуждение')).length).toBeGreaterThan(0)
    expect(fetchPublicData).toHaveBeenLastCalledWith({
      refresh:true, minMeta:expect.objectContaining({ day:3, totalPosts:325 }),
    })
    expect(screen.queryByTestId('lite-feed-notice')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name:'Активность постов' })).toBeInTheDocument()
    expect(document.querySelector('.new-posts-bubble')).toBeNull()
    expect(screen.getByTestId('session-mtt-widget').querySelectorAll('.smtt-bar')).toHaveLength(3)
  })

  it('keeps recent posts visible and provides a retry when the archive fails', async () => {
    const data = makeData()
    fetchPublicData.mockImplementation(options => options?.mode === 'recent'
      ? Promise.resolve(structuredClone(data.recent))
      : Promise.reject(new Error('offline')))
    render(<App />)
    await screen.findByTestId('lite-feed-notice')
    fireEvent.click(screen.getAllByRole('button', { name:'Загрузить всю историю' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('Свежие посты доступны')
    expect(screen.getAllByText('Свежий отчет').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name:'Загрузить всю историю' })[0]).toBeEnabled()

    fetchPublicData.mockResolvedValue(structuredClone(data.full))
    fireEvent.click(screen.getAllByRole('button', { name:'Загрузить всю историю' })[0])
    await waitFor(() => expect(screen.queryByTestId('lite-feed-notice')).not.toBeInTheDocument())
  })

  it('keeps the desktop full-feed default unchanged', async () => {
    window.innerWidth = 1280
    render(<App />)
    expect((await screen.findAllByText('Архивное обсуждение')).length).toBeGreaterThan(0)
    expect(fetchPublicData).toHaveBeenCalledWith()
    expect(screen.queryByTestId('lite-feed-notice')).not.toBeInTheDocument()
  })

  it.each(['EN', 'ES'])('translates the light-feed notice in %s without fetching the archive', async lang => {
    render(<App />)
    await screen.findByTestId('lite-feed-notice')
    fireEvent.click(within(document.querySelector('.lang-switch')).getByRole('button', { name:lang, exact:true }))
    expect(screen.getByTestId('lite-feed-notice')).toHaveTextContent(lang === 'EN' ? 'Light feed' : 'Feed ligero')
    expect(fetchPublicData).toHaveBeenCalledTimes(1)
  })
})
