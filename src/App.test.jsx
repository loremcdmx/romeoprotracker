import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

function makeMockData(overrides = {}) {
  return {
    posts: [
      {
        id: '1',
        author: 'Romeopro',
        text: 'Day #5 marathon. After session: 11000',
        likes: 42,
        timestamp: 1712500000,
        date: '07.04.26',
        avatar: null,
        rating: 5000,
        msgCount: 100,
        regData: '2020',
        brAfter: 11000,
        images: [],
        url: 'https://forum.gipsyteam.ru/test1',
      },
      {
        id: '2',
        author: 'TestUser',
        text: 'Interesting post about poker and Romeo.',
        likes: 10,
        timestamp: 1712400000,
        date: '06.04.26',
        avatar: null,
        rating: 1000,
        msgCount: 50,
        regData: '2021',
        brAfter: null,
        images: [],
        url: 'https://forum.gipsyteam.ru/test2',
      },
      {
        id: '3',
        author: 'Romeopro',
        text: '[QUOTE]somebody\ncited text[/QUOTE]My answer',
        likes: 100,
        timestamp: 1712300000,
        date: '05.04.26',
        avatar: null,
        rating: 5000,
        msgCount: 100,
        regData: '2020',
        brAfter: 10500,
        images: ['https://example.com/img.jpg'],
        url: 'https://forum.gipsyteam.ru/test3',
      },
    ],
    meta: {
      startBankroll: 10000,
      totalTournaments: 3565,
      brHistory: [
        { brAfter: 10500, date: '05.04', timestamp: 1712300000, sessionResult: 500, text: 'Day #3' },
        { brAfter: 11000, date: '07.04', timestamp: 1712500000, sessionResult: 500, text: 'Day #5' },
      ],
      lastUpdated: '2026-04-19T02:00:00.000Z',
    },
    ...overrides,
  }
}

function findPostCardByAuthor(author) {
  return [...document.querySelectorAll('.post-card')].find((card) =>
    card.querySelector('.pc-author')?.textContent === author,
  ) ?? null
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(makeMockData())
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('renders loading state then content', async () => {
    render(<App />)
    expect(await screen.findByText(translate('ru', 'hs_br'))).toBeInTheDocument()
  })

  it('renders hero stats', async () => {
    render(<App />)
    expect(await screen.findByText(translate('ru', 'hs_br'))).toBeInTheDocument()
    expect(screen.getAllByText(translate('ru', 'hs_profit')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(translate('ru', 'hs_day')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(translate('ru', 'hs_tourneys')).length).toBeGreaterThanOrEqual(1)
  })

  it('renders marathon chart', async () => {
    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
  })

  it('renders post cards in feed', async () => {
    render(<App />)
    const elements = await screen.findAllByText('Romeopro')
    expect(elements.length).toBeGreaterThan(1)
  })

  it('renders topbar with tabs', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(screen.getAllByText(translate('ru', 'tab_feed')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(translate('ru', 'tab_topics')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(translate('ru', 'tab_settings')).length).toBeGreaterThanOrEqual(1)
  })

  it('switches to topics tab', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    fireEvent.click(screen.getAllByText(translate('ru', 'tab_topics'))[0])
    expect(screen.getByText(new RegExp(translate('ru', 'topic_marathon')))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(translate('ru', 'topic_discussion')))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(translate('ru', 'topic_highlikes')))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(translate('ru', 'topic_tags')))).toBeInTheDocument()
  })

  it('switches to settings tab and shows ignore list', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    fireEvent.click(screen.getAllByText(translate('ru', 'tab_settings'))[0])
    expect(screen.getByText(new RegExp(translate('ru', 'settings_ignored_authors')))).toBeInTheDocument()
  })

  it('toggles theme', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const themeBtn = screen.getByTitle(new RegExp(translate('ru', 'theme_light'), 'i'))
    fireEvent.click(themeBtn)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    fireEvent.click(screen.getByTitle(new RegExp(translate('ru', 'theme_dark'), 'i')))
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('renders sidebar with stats', async () => {
    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'stats')))).toBeInTheDocument()
  })

  it('renders forum stats with authors and top posts section', async () => {
    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'forum_stats')))).toBeInTheDocument()
    expect(screen.getByText(translate('ru', 'sr_authors'))).toBeInTheDocument()
    expect(await screen.findByText(new RegExp(translate('ru', 'top_likes_header')))).toBeInTheDocument()
  })

  it('renders footer with version and changelog', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(screen.getAllByText('v1.8').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(translate('ru', 'footer_changelog'))).toBeInTheDocument()
  })

  it('renders pagination', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const pageInfos = screen.getAllByText(new RegExp(translate('ru', 'page_of')))
    expect(pageInfos.length).toBeGreaterThan(0)
  })

  it('renders filter bar with romeo filter', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(screen.getAllByText(translate('ru', 'day_romeo')).length).toBeGreaterThan(0)
  })

  it('renders progress bar', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(document.querySelector('.marathon-progress')).toBeInTheDocument()
  })

  it('renders links section in sidebar', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(screen.getByRole('link', { name: new RegExp(translate('ru', 'settings_forum_thread')) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(translate('ru', 'settings_source')) })).toBeInTheDocument()
  })

  it('renders retry state and recovers after refresh', async () => {
    fetchPublicData.mockReset()
    fetchPublicData
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(makeMockData())

    render(<App />)

    expect(await screen.findByText(translate('ru', 'load_failed_title'))).toBeInTheDocument()
    fireEvent.click(screen.getByText(translate('ru', 'retry')))
    expect((await screen.findAllByText('Romeopro')).length).toBeGreaterThan(0)
  })

  it('switches language and persists it', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))

    await waitFor(() => {
      expect(screen.getAllByText(translate('en', 'tab_feed')).length).toBeGreaterThanOrEqual(1)
      expect(localStorage.getItem('rpt_lang')).toBe('en')
    })

    expect(screen.getByText(translate('en', 'hs_br'))).toBeInTheDocument()
  })

  it('applies and resets feed filters', async () => {
    render(<App />)
    expect((await screen.findAllByText('TestUser')).length).toBeGreaterThan(0)

    const minLikesInput = screen
      .getAllByTitle(translate('ru', 'filter_min_likes'))
      .find((node) => node.tagName === 'INPUT')
    fireEvent.change(minLikesInput, { target: { value: '50' } })

    await waitFor(() => {
      expect(screen.queryAllByText('TestUser')).toHaveLength(0)
    })

    fireEvent.click(screen.getByTitle(translate('ru', 'filter_reset')))

    expect((await screen.findAllByText('TestUser')).length).toBeGreaterThan(0)
  })

  it('keeps favorited authors visible regardless of active feed filters', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')

    const testUserCard = findPostCardByAuthor('TestUser')
    fireEvent.click(within(testUserCard).getByTitle(translate('ru', 'pc_fav_add')))

    fireEvent.change(
      screen
        .getAllByTitle(translate('ru', 'filter_min_likes'))
        .find((node) => node.tagName === 'INPUT'),
      { target: { value: '50' } },
    )
    fireEvent.click(screen.getByTitle(translate('ru', 'filter_search_title')))
    fireEvent.change(screen.getByPlaceholderText(translate('ru', 'filter_search_placeholder')), {
      target: { value: 'no chance to match this query' },
    })

    await waitFor(() => {
      const authors = [...document.querySelectorAll('.post-card .pc-author')].map((node) => node.textContent)
      expect(authors).toContain('TestUser')
      expect(findPostCardByAuthor('TestUser')).not.toBeNull()
    })
  })

  it('keeps romeoOnly strict even for favorited authors', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')

    const testUserCard = findPostCardByAuthor('TestUser')
    fireEvent.click(within(testUserCard).getByTitle(translate('ru', 'pc_fav_add')))
    fireEvent.click(screen.getByTitle(translate('ru', 'filter_romeo_title')))

    await waitFor(() => {
      const authors = [...document.querySelectorAll('.post-card .pc-author')].map((node) => node.textContent)
      expect(authors).not.toContain('TestUser')
      expect(authors.every((author) => author === 'Romeopro')).toBe(true)
    })
  })

  it('hides ignored authors even when they are favorited and match active filters', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')

    const findTestUserCard = () => findPostCardByAuthor('TestUser')

    fireEvent.click(within(findTestUserCard()).getByTitle(translate('ru', 'pc_fav_add')))
    fireEvent.click(screen.getByTitle(translate('ru', 'filter_search_title')))
    fireEvent.change(screen.getByPlaceholderText(translate('ru', 'filter_search_placeholder')), {
      target: { value: 'Interesting post about poker and Romeo.' },
    })

    await waitFor(() => {
      expect(findTestUserCard()).not.toBeNull()
    })

    fireEvent.click(within(findTestUserCard()).getByTitle(translate('ru', 'pc_ignore')))

    await waitFor(() => {
      const authors = [...document.querySelectorAll('.post-card .pc-author')].map((node) => node.textContent)
      expect(authors).not.toContain('TestUser')
      expect(findTestUserCard()).toBeNull()
    })
  })
})
