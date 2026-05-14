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

function makeMockLeaderboards() {
  return {
    source: 'ggpoker-pml',
    officialPage: 'https://ggpoker.com/tournaments/ggpoker-world-festival/',
    fetchedAt: '2026-05-14T09:02:14.754Z',
    finishedAt: '2099-06-11T23:59:59.000+00:00',
    targetNick: 'R Romanovskyi',
    leaderboards: [
      {
        tier: 'Low',
        target: { rank: 107, nickname: 'R Romanovskyi', point: 1732.59, prizeValue: 150, prizeCurrency: 'GCD' },
        top: [
          { rank: 1, nickname: 'Mala_Ale_Farsa', point: 3370.04, prizeValue: 20000, prizeCurrency: 'USD' },
          { rank: 2, nickname: 'Anton Ivar', point: 3244.61, prizeValue: 12500, prizeCurrency: 'USD' },
          { rank: 3, nickname: 'HappyNewFear', point: 2899.71, prizeValue: 8000, prizeCurrency: 'USD' },
        ],
      },
      {
        tier: 'Medium',
        target: { rank: 4, nickname: 'R Romanovskyi', point: 2675.44, prizeValue: 20000, prizeCurrency: 'USD' },
        top: [
          { rank: 1, nickname: 'ANTON BARDZIYAN', point: 2826.77, prizeValue: 50000, prizeCurrency: 'USD' },
          { rank: 2, nickname: 'Bowrot-', point: 2801.82, prizeValue: 35000, prizeCurrency: 'USD' },
          { rank: 3, nickname: 'Armanus', point: 2690.35, prizeValue: 25000, prizeCurrency: 'USD' },
        ],
      },
      {
        tier: 'High',
        target: { rank: 1, nickname: 'R Romanovskyi', point: 1956.18, prizeValue: 80000, prizeCurrency: 'USD' },
        top: [
          { rank: 1, nickname: 'R Romanovskyi', point: 1956.18, prizeValue: 80000, prizeCurrency: 'USD' },
          { rank: 2, nickname: 'Tom_Poker_BR', point: 1946.99, prizeValue: 60000, prizeCurrency: 'USD' },
          { rank: 3, nickname: 'Ronan Sweeney', point: 1935.38, prizeValue: 45000, prizeCurrency: 'USD' },
        ],
      },
    ],
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

  it('renders GGWF leaderboard widget with leaders, Romeo, and prizes', async () => {
    fetchPublicData.mockResolvedValue(makeMockData({ leaderboards: makeMockLeaderboards() }))
    render(<App />)

    expect(await screen.findByText(translate('ru', 'leaderboards_title'))).toBeInTheDocument()
    expect(screen.getByText('Mala_Ale_Farsa')).toBeInTheDocument()
    expect(screen.getAllByText(translate('ru', 'leaderboards_points')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('3,370.04').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Romeo #107')).not.toBeInTheDocument()
    expect(screen.getAllByText('#107').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('до топ-3: 1,167.12 pts')).toBeInTheDocument()
    expect(screen.queryByText('лидер борда')).not.toBeInTheDocument()
    expect(screen.getByText('$300K')).toBeInTheDocument()
    expect(screen.getAllByText('GCD 150').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(translate('ru', 'leaderboards_points_help'))).toBeInTheDocument()
  })

  it('anchors activity chart edge labels inside the SVG bounds', async () => {
    const day = 86400
    const posts = Array.from({ length:61 }, (_, i) => ({
      id: `activity-${i}`,
      author: i % 5 === 0 ? 'Romeopro' : `User${i}`,
      text: `Activity post ${i}`,
      likes: i % 10,
      timestamp: 1710028800 + i * day,
      date: `D${i}`,
      rating: 1000,
      msgCount: i,
      regData: '2024',
      brAfter: null,
      images: [],
      url: `https://forum.gipsyteam.ru/activity-${i}`,
    }))
    fetchPublicData.mockResolvedValue(makeMockData({ posts }))
    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_activity')))).toBeInTheDocument()
    fireEvent.click(screen.getAllByText(translate('ru', 'period_all_marathon'))[0])

    const labels = document.querySelectorAll('.chart-label')
    expect(labels.length).toBeGreaterThan(1)
    expect([...labels].some(label => label.getAttribute('text-anchor') === 'start')).toBe(true)
    expect([...labels].some(label => label.getAttribute('text-anchor') === 'end')).toBe(true)
  })

  it('uses semantic event labels on the marathon X axis', async () => {
    const base = makeMockData()
    const brs = [18000, 31000, 48000, 76000, 91000, 101000, 122000, 121000, 112000, 119000]
    const totals = [1000, 2000, 3000, 4000, 5000, 6000, 7800, 8400, 9200, 10000]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      const totalTournaments = totals[i]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: 1712300000 + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments,
        tournaments: i === 0 ? totalTournaments : totalTournaments - totals[i - 1],
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 10000,
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const labels = [...document.querySelectorAll('.mc-xaxis-label-main')].map(label => label.textContent)
    const allAxisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')
    const bestLabel = document.querySelector('.mc-x-tick.best .mc-xaxis-label-main')
    const peakCallout = document.querySelector('.mc-peak-callout')
    expect(allAxisText).toContain('$100k')
    expect(bestLabel?.textContent).toMatch(/^\+/)
    expect(labels.some(label => label?.includes('БЕСТ'))).toBe(false)
    expect(labels.some(label => label?.includes('ВОРСТ'))).toBe(true)
    expect(allAxisText).not.toContain('ПИК')
    expect(document.querySelector('.mc-x-tick.peak')).not.toBeInTheDocument()
    expect(peakCallout).toBeInTheDocument()
    expect(peakCallout).toHaveAttribute('data-idx', '6')
    expect(peakCallout?.textContent).toContain('ПИК')
    expect(peakCallout?.textContent).toContain('$122k')
    expect(document.querySelector('.mc-x-tick.milestone')).toBeInTheDocument()
    expect(document.querySelector('.mc-x-tick.best')).toBeInTheDocument()
    expect(document.querySelector('.mc-x-tick.worst')).toBeInTheDocument()
    expect(document.querySelectorAll('.mc-profit-band')).toHaveLength(0)
    expect(document.querySelector('.mc-plot-glow')).toBeInTheDocument()
    expect(document.querySelector('.mc-line-aura')).toBeInTheDocument()
    expect(document.querySelector('.mc-line-highlight')).toBeInTheDocument()
    expect(document.querySelectorAll('#mcLineGrad stop').length).toBeGreaterThan(brHistory.length)
  })

  it('labels the first session and the sustained $10k recovery point', async () => {
    const base = makeMockData()
    const brs = [
      9954, 8710, 9099, 12321, 6737, 5257, 3020, 3211,
      2876, 4192, 6902, 10371, 9957, 8697, 10270, 10190,
      11334, 22131,
    ]
    const totals = [
      167, 391, 621, 832, 1090, 1302, 1547, 1771,
      1999, 2254, 2501, 3314, 3565, 3840, 4101, 4307,
      4625, 4882,
    ]
    const startTs = Date.UTC(2026, 2, 11, 12, 0, 0) / 1000
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      const totalTournaments = totals[i]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: startTs + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments,
        tournaments: i === 0 ? totalTournaments : totalTournaments - totals[i - 1],
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: totals.at(-1),
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    expect(document.querySelector('.mc-x-tick.start .mc-xaxis-label-main')?.textContent).toBe('первая сессия')
    expect(document.querySelector('.mc-x-tick.recovery .mc-xaxis-label-main')?.textContent).toBe('$10k')
    expect(document.querySelector('.mc-x-tick.recovery .mc-xaxis-label-sub')?.textContent).toContain('перелом')
    const axisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')
    expect(axisText).not.toContain('167')
  })

  it('labels filtered marathon start with baseline profit and tournaments', async () => {
    const base = makeMockData()
    const now = Math.floor(Date.now() / 1000)
    const day = 86400
    const brHistory = [
      { brAfter: 30000, timestamp: now - 60 * day, sessionResult: 20000, totalTournaments: 1000, tournaments: 1000, text: 'Old 1' },
      { brAfter: 55000, timestamp: now - 40 * day, sessionResult: 25000, totalTournaments: 2000, tournaments: 1000, text: 'Old 2' },
      { brAfter: 62000, timestamp: now - 20 * day, sessionResult: 7000, totalTournaments: 2500, tournaments: 500, text: 'Month 1' },
      { brAfter: 70000, timestamp: now - 10 * day, sessionResult: 8000, totalTournaments: 3000, tournaments: 500, text: 'Month 2' },
      { brAfter: 68000, timestamp: now - 2 * day, sessionResult: -2000, totalTournaments: 3300, tournaments: 300, text: 'Month 3' },
    ]
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 3300,
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    fireEvent.click(screen.getAllByText(translate('ru', 'period_month'))[0])

    await waitFor(() => expect(document.querySelector('.mc-x-tick.range-start')).toBeInTheDocument())
    const allAxisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')

    expect(allAxisText).toContain('СТАРТ +45.0k$')
    expect(allAxisText).toContain('2\u202F000 МТТ')
  })

  it('moves the in-plot peak callout to a new all-time high automatically', async () => {
    const base = makeMockData()
    const brs = [20000, 55000, 52000, 140000]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: 1712300000 + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments: (i + 1) * 1000,
        tournaments: 1000,
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 4000,
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const peakCallout = document.querySelector('.mc-peak-callout')
    const axisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')
    expect(peakCallout).toHaveAttribute('data-idx', '3')
    expect(peakCallout?.textContent).toContain('ПИК')
    expect(peakCallout?.textContent).toContain('$140k')
    expect(axisText).not.toContain('ПИК')
  })

  it('thins milestone labels when event labels crowd the chart tail', async () => {
    const base = makeMockData()
    const brs = [18000, 31000, 48000, 76000, 101000, 126000, 176000, 156000, 153000]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: 1712300000 + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments: (i + 1) * 1000,
        tournaments: 1000,
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 9000,
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const allAxisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')

    expect(document.querySelector('.mc-x-tick.best .mc-xaxis-label-main')?.textContent).toMatch(/^\+/)
    expect(allAxisText).not.toContain('БЕСТ')
    expect(allAxisText).not.toContain('ПИК')
    expect(allAxisText).toContain('$100k')
    expect(allAxisText).not.toContain('$75k')
    expect(allAxisText).not.toContain('$125k')
    expect(allAxisText).not.toContain('$150k')
    expect(new Set([...document.querySelectorAll('.mc-xaxis-label-main')].map(label => label.getAttribute('y'))).size).toBe(1)
    expect(new Set([...document.querySelectorAll('.mc-xaxis-label-sub')].map(label => label.getAttribute('y'))).size).toBe(1)
  })

  it('condenses dense same-sign marathon markers and uses rebuilt axes', async () => {
    const base = makeMockData()
    const brHistory = Array.from({ length:80 }, (_, i) => ({
      brAfter: 10000 + (i + 1) * 900,
      brPrev: 10000 + i * 900,
      date: `D${i + 1}`,
      timestamp: 1712300000 + i * 3600,
      sessionResult: 900,
      totalTournaments: (i + 1) * 100,
      tournaments: 100,
      text: `Session ${i + 1}`,
    }))
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 8000,
      },
    }))

    render(<App />)

    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    expect(document.querySelectorAll('.mc-dot').length).toBeLessThan(brHistory.length)
    expect(document.querySelectorAll('.mc-dot-grouped-ring').length).toBeGreaterThan(0)
    const tailMarkers = [...document.querySelectorAll('g[data-start][data-end]')]
      .filter(marker => Number(marker.dataset.start) >= brHistory.length - 5)
    expect(tailMarkers).toHaveLength(5)
    expect(tailMarkers.every(marker => marker.dataset.count === '1')).toBe(true)
    expect(document.querySelectorAll('.mc-xlabel-bg')).toHaveLength(0)
    expect(document.querySelectorAll('.mc-ylabel-bg')).toHaveLength(0)
    expect(document.querySelectorAll('.mc-xaxis-label-main').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.mc-yaxis-label').length).toBeGreaterThan(0)

    const groupedRing = document.querySelector('.mc-dot-grouped-ring')
    const hoverTarget = groupedRing?.parentElement?.querySelector('circle[fill="transparent"]')
    expect(hoverTarget).toBeTruthy()
    fireEvent.mouseEnter(hoverTarget)
    expect(document.querySelector('.mc-session-breakdown')).toBeInTheDocument()
    expect(document.querySelectorAll('.mc-session-row').length).toBeGreaterThan(1)
  })

  it('tones down the crowded last marathon marker so adjacent points stay readable', async () => {
    const base = makeMockData()
    const brs = [20000, 50000, 100000, 175000, 156363, 153715]
    const totals = [5000, 7000, 9000, 11000, 11740, 11799]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      const totalTournaments = totals[i]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: 1712300000 + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments,
        tournaments: i === 0 ? totalTournaments : totalTournaments - totals[i - 1],
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: 11799,
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const lastMarker = document.querySelector('g[data-end="5"]')
    const lastDot = lastMarker?.querySelector('.mc-dot')
    expect(lastDot).toBeInTheDocument()
    expect(lastDot).toHaveClass('mc-dot-crowded')
    expect(lastDot).not.toHaveClass('mc-dot-last')
    expect(Number(lastDot.getAttribute('r'))).toBeLessThan(5)
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
    expect(screen.getAllByText(translate('ru', 'tab_settings')).length).toBeGreaterThanOrEqual(1)
  })

  it('does not render the topics section tab', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(document.querySelectorAll('.topbar-tab')).toHaveLength(2)
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
    expect(screen.getAllByText('v1.10').length).toBeGreaterThanOrEqual(1)
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
