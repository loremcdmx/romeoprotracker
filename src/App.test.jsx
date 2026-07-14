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

function parseLinearSvgPath(path) {
  const values = path?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
  const points = []
  for (let i = 0; i < values.length - 1; i += 2) {
    points.push({ x:values[i], y:values[i + 1] })
  }
  return points
}

function yOnLinearPath(points, x) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    if (x < minX || x > maxX) continue

    const span = b.x - a.x
    if (Math.abs(span) < 0.001) return b.y
    const t = (x - a.x) / span
    return a.y + (b.y - a.y) * t
  }
  return null
}

function estimatedSvgTextRect(el, fontSize, anchor = 'middle') {
  const x = Number(el?.getAttribute('x'))
  const y = Number(el?.getAttribute('y'))
  const text = el?.textContent || ''
  const width = text.length * fontSize * .58
  const height = fontSize + 4
  let left = x - width / 2
  if (anchor === 'end') left = x - width
  if (anchor === 'start') left = x
  return {
    left,
    right:left + width,
    top:y - height + 3,
    bottom:y + 4,
  }
}

function rectsOverlap(a, b, gap = 0) {
  return a.left < b.right + gap
    && a.right > b.left - gap
    && a.top < b.bottom + gap
    && a.bottom > b.top - gap
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
    expect(screen.getByText('2 BR-апдейта')).toBeInTheDocument()
    expect(screen.queryByText('2 сессии')).not.toBeInTheDocument()
  })

  it('renders clean all-time month ticks and anchors every milestone label to its source point', async () => {
    const base = makeMockData()
    const samples = [
      ['m1', Date.UTC(2026, 2, 2) / 1000, 8000],
      ['m2', Date.UTC(2026, 2, 18) / 1000, 11000],
      ['a1', Date.UTC(2026, 3, 4) / 1000, 68800],
      ['m3', Date.UTC(2026, 4, 7) / 1000, 120000],
      ['j1', Date.UTC(2026, 5, 8) / 1000, 170000],
      ['j2', Date.UTC(2026, 6, 9) / 1000, 210000],
      ['j3', Date.UTC(2026, 6, 11) / 1000, 220000],
    ]
    const brHistory = samples.map(([id, timestamp, brAfter], i) => {
      const brPrev = i === 0 ? 10000 : samples[i - 1][2]
      return {
        id,
        timestamp,
        brAfter,
        brPrev,
        sessionResult:brAfter - brPrev,
        totalTournaments:(i + 1) * 1000,
        tournaments:1000,
        text:`Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta:{ ...base.meta, brHistory, totalTournaments:7000 },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    expect([...document.querySelectorAll('.mc-month-label-main')].map(node => node.textContent))
      .toEqual(['МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ'])
    expect(document.querySelector('.mc-axis-event-layer')).toHaveClass('is-hidden')
    expect(document.querySelector('.mc-line-main')).toHaveAttribute('stroke-width', '3.2')
    expect(document.querySelector('.mc-line-aura')).toHaveAttribute('stroke-width', '7')
    expect(document.querySelectorAll('.mc-line-segment')).toHaveLength(brHistory.length - 1)

    const best = document.querySelector('.mc-milestone-callout.best')
    expect(best?.textContent).toContain('+$57.8k')
    expect(best).toHaveAttribute('data-source-id', 'a1')
    expect(best?.querySelector('.mc-milestone-plate')).toBeInTheDocument()
    const bestSegment = document.querySelector('.mc-line-segment[data-source-id="a1"]')
    expect(Number(bestSegment?.getAttribute('x2'))).toBeCloseTo(
      Number(best?.querySelector('.mc-milestone-anchor')?.getAttribute('cx')),
      5,
    )
    expect(Number(bestSegment?.getAttribute('y2'))).toBeCloseTo(
      Number(best?.querySelector('.mc-milestone-anchor')?.getAttribute('cy')),
      5,
    )

    const linePoints = parseLinearSvgPath(document.querySelector('.mc-line-main')?.getAttribute('d'))
    for (const callout of document.querySelectorAll('.mc-milestone-callout:not(.compact)')) {
      const leader = callout.querySelector('[data-role="milestone-leader"]')
      const anchor = callout.querySelector('.mc-milestone-anchor')
      const x = Number(anchor?.getAttribute('cx'))
      const y = Number(anchor?.getAttribute('cy'))
      expect(Number(leader?.getAttribute('x1'))).toBeCloseTo(x, 5)
      expect(Number(leader?.getAttribute('y1'))).toBeCloseTo(y, 5)
      expect(yOnLinearPath(linePoints, x)).toBeCloseTo(y, 1)
    }
  })

  it('thins tournament-weighted month ticks without dropping the first or latest month', async () => {
    const base = makeMockData()
    const totals = [1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 10000]
    const brHistory = totals.map((totalTournaments, i) => ({
      id:`month-${i}`,
      timestamp:Date.UTC(2026, i, 5) / 1000,
      brAfter:11000 + i * 1000,
      brPrev:10000 + i * 1000,
      sessionResult:1000,
      totalTournaments,
      tournaments:i === 0 ? totalTournaments : totalTournaments - totals[i - 1],
      text:`Month ${i + 1}`,
    }))
    fetchPublicData.mockResolvedValue(makeMockData({
      meta:{ ...base.meta, brHistory, totalTournaments:totals.at(-1) },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const ticks = [...document.querySelectorAll('.mc-month-tick')]
    expect(ticks.map(tick => tick.querySelector('.mc-month-label-main')?.textContent)).toEqual(['ЯНВ', 'ОКТ'])
    expect(ticks[0]).toHaveAttribute('data-source-id', 'month-0')
    expect(ticks.at(-1)).toHaveAttribute('data-source-id', 'month-9')
    expect(Number(ticks.at(-1)?.querySelector('.mc-month-tickmark')?.getAttribute('x1'))
      - Number(ticks[0]?.querySelector('.mc-month-tickmark')?.getAttribute('x1'))).toBeGreaterThanOrEqual(68)
  })

  it('compacts crowded marathon tail markers while keeping the latest point readable', async () => {
    const now = Math.floor(Date.now() / 1000)
    const totals = [1000, 2400, 3900, 5400, 6900, 8200, 9000, 9400, 9450, 9500, 9550, 9600, 9650, 9700]
    let br = 10000
    const brHistory = totals.map((total, i) => {
      const brPrev = br
      const sessionResult = i < 8 ? 850 : (i % 2 === 0 ? 420 : -360)
      br += sessionResult
      return {
        brAfter: br,
        brPrev,
        date: `T${i + 1}`,
        timestamp: now - (totals.length - i) * 3600,
        sessionResult,
        totalTournaments: total,
        tournaments: i === 0 ? total : total - totals[i - 1],
        text: `Tail session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: { ...makeMockData().meta, brHistory, totalTournaments: totals[totals.length - 1] },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const markers = [...document.querySelectorAll('.marathon-chart g[data-start][data-end]')]
    const latest = markers[markers.length - 1]
    const previous = markers[markers.length - 2]
    const latestDot = latest?.querySelector('.mc-dot')
    const previousDot = previous?.querySelector('.mc-dot')
    const previousAnchor = previous?.querySelector('.mc-dot-cluster-hit') || previousDot
    const latestX = Number(latestDot?.getAttribute('cx'))
    const latestY = Number(latestDot?.getAttribute('cy'))
    const previousX = Number(previousAnchor?.getAttribute('cx'))
    const previousY = Number(previousAnchor?.getAttribute('cy'))
    const previousClusterParts = previous?.querySelectorAll('.mc-dot-cluster-part') || []

    expect(markers.length).toBeLessThan(brHistory.length)
    expect(Number(latest?.getAttribute('data-start'))).toBe(brHistory.length - 1)
    expect(Number(latest?.getAttribute('data-end'))).toBe(brHistory.length - 1)
    expect(Number(latest?.getAttribute('data-count'))).toBe(1)
    expect(Number(previous?.getAttribute('data-count'))).toBeGreaterThan(1)
    if (previousClusterParts.length) {
      expect(previousClusterParts.length).toBeGreaterThan(1)
      expect(previous?.querySelector('.mc-dot-cluster-hit')).toBeInTheDocument()
    } else {
      expect(previousDot).toHaveClass('mc-dot-compacted')
      expect(previous?.querySelector('.mc-dot-mixed-ring')).toBeInTheDocument()
    }
    expect(Math.hypot(latestX - previousX, latestY - previousY)).toBeGreaterThanOrEqual(20)
  })

  it('renders pace widget and applies the shared date period filters', async () => {
    const now = Math.floor(Date.now() / 1000)
    const brs = [15000, 20000, 26000, 32000]
    const totals = [1000, 2000, 3000, 4000]
    const timestamps = [now - 13 * 86400, now - 9 * 86400, now - 5 * 86400, now - 86400]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: timestamps[i],
        sessionResult: brAfter - brPrev,
        totalTournaments: totals[i],
        tournaments: i === 0 ? totals[i] : totals[i] - totals[i - 1],
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...makeMockData().meta,
        brHistory,
        totalTournaments: 4000,
      },
    }))

    render(<App />)
    const widget = await screen.findByTestId('pace-widget')
    expect(within(widget).getByText(translate('ru', 'pace_title'))).toBeInTheDocument()
    expect(within(widget).getByText(translate('ru', 'pace_rate_all'))).toBeInTheDocument()
    expect(within(widget).queryByText(translate('ru', 'pace_rate_now'))).not.toBeInTheDocument()
    expect(within(widget).getAllByText('+5.5$/МТТ').length).toBeGreaterThanOrEqual(1)
    expect(within(widget).queryByText(translate('ru', 'pace_rate_prev'))).not.toBeInTheDocument()
    expect(within(widget).queryByText(translate('ru', 'pace_all_note'))).not.toBeInTheDocument()
    expect(within(widget).queryByText(/при текущем темпе/)).not.toBeInTheDocument()
    expect(within(widget).getByText(translate('ru', 'pace_finish'))).toBeInTheDocument()
    expect(within(widget).queryByText(translate('ru', 'pace_finish_note'))).not.toBeInTheDocument()
    expect(within(widget).getByTestId('pace-chart')).toBeInTheDocument()
    expect(within(widget).getByText((text) => text.replace(/\s/g, ' ') === 'шаг: 2 000 МТТ')).toBeInTheDocument()
    expect(within(widget).queryByText(translate('ru', 'pace_chart_title'))).not.toBeInTheDocument()
    expect(within(widget).getByText(translate('ru', 'pace_trend_card'))).toBeInTheDocument()
    expect(widget.querySelector('.pace-trend-label')).toBeInTheDocument()
    expect(widget.querySelectorAll('.pace-y-label').length).toBeGreaterThanOrEqual(5)
    expect(within(widget).getAllByText('2k').length).toBeGreaterThanOrEqual(1)
    expect(within(widget).getAllByText('4k').length).toBeGreaterThanOrEqual(1)
    const paceLineStart = widget.querySelector('.pace-line:not(.partial)')?.getAttribute('d')?.match(/^M ([\d.]+) ([\d.]+)/)
    const plotLeft = Number(widget.querySelector('.pace-plot-bg')?.getAttribute('x'))
    const zeroAxisY = Number(widget.querySelector('.pace-y-label.zero')?.getAttribute('y')) - 4
    expect(Number(paceLineStart?.[1])).toBeCloseTo(plotLeft, 1)
    expect(Number(paceLineStart?.[2])).toBeCloseTo(zeroAxisY, 1)

    fireEvent.click(within(widget).getByText(translate('ru', 'period_week')))

    await waitFor(() => {
      expect(within(widget).getAllByText('+6$/МТТ').length).toBeGreaterThanOrEqual(1)
    })
    expect(within(widget).getByText(translate('ru', 'pace_rate_now'))).toBeInTheDocument()
    await waitFor(() => {
      expect(within(widget).getAllByText('+5$/МТТ').length).toBeGreaterThanOrEqual(1)
    })
    expect(within(widget).getByText(translate('ru', 'pace_rate_prev'))).toBeInTheDocument()
    expect(within(widget).getByText('изменение: +1$/МТТ')).toBeInTheDocument()
    expect(within(widget).queryByText(/при текущем темпе/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(widget.querySelector('.pace-projection-item .tempo-val')?.textContent?.replace(/\s/g, '')).toBe('~1661334турниров')
    })
    expect(within(widget).getAllByText('2k').length).toBeGreaterThanOrEqual(1)
    expect(within(widget).queryByText('1k')).not.toBeInTheDocument()
  })

  it('drops the colliding full-bin pace label when the total sits just past a bin', async () => {
    const now = Math.floor(Date.now() / 1000)
    const totals = [2000, 4000, 6000, 8000, 10000, 12000, 14000, 14165]
    let br = 10000
    const brHistory = totals.map((total, i) => {
      const brPrev = br
      br += 1500
      return {
        brAfter: br,
        brPrev,
        date: `D${i + 1}`,
        timestamp: now - (totals.length - i) * 86400,
        sessionResult: 1500,
        totalTournaments: total,
        tournaments: i === 0 ? total : total - totals[i - 1],
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: { ...makeMockData().meta, brHistory, totalTournaments: 14165 },
    }))

    render(<App />)
    const widget = await screen.findByTestId('pace-widget')
    const labels = [...widget.querySelectorAll('.pace-x-label')]
      .map((el) => ({ x: Number(el.getAttribute('x')), txt: el.textContent.trim() }))
      .filter((l) => Number.isFinite(l.x))

    // the current-total label stays; the full-bin tick it would overlap is dropped
    expect(labels.some((l) => l.txt === '14.2k')).toBe(true)
    expect(labels.some((l) => l.txt === '14k')).toBe(false)
    // no two x-axis labels collide (within 30px)
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(Math.abs(labels[i].x - labels[j].x)).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('keeps the pace trend label clear of the latest value label and marker', async () => {
    const now = Math.floor(Date.now() / 1000)
    const rates = [-35, 12, 18, 22.8]
    let br = 10000
    const brHistory = rates.map((rate, i) => {
      const brPrev = br
      const tournaments = 2000
      br += rate * tournaments
      return {
        brAfter: br,
        brPrev,
        date: `T${i + 1}`,
        timestamp: now - (rates.length - i) * 86400,
        sessionResult: rate * tournaments,
        totalTournaments: (i + 1) * tournaments,
        tournaments,
        text: `Pace label overlap session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: { ...makeMockData().meta, brHistory, totalTournaments: 8000 },
    }))

    render(<App />)
    const widget = await screen.findByTestId('pace-widget')
    const trendLabel = widget.querySelector('.pace-trend-label')
    const latestValue = widget.querySelector('.pace-segment.latest .pace-chart-value')
    const latestDot = widget.querySelector('.pace-segment.latest .pace-dot')

    expect(trendLabel?.closest('.pace-trend')).toHaveClass('shifted')
    expect(latestValue).toBeInTheDocument()
    expect(latestDot).toBeInTheDocument()

    const trendRect = estimatedSvgTextRect(trendLabel, 8.6, 'end')
    const valueRect = estimatedSvgTextRect(latestValue, 10, latestValue.classList.contains('edge') ? 'end' : 'middle')
    const dotX = Number(latestDot.getAttribute('cx'))
    const dotY = Number(latestDot.getAttribute('cy'))
    const dotRect = { left:dotX - 12, right:dotX + 12, top:dotY - 12, bottom:dotY + 12 }

    expect(rectsOverlap(trendRect, valueRect, 3)).toBe(false)
    expect(rectsOverlap(trendRect, dotRect, 3)).toBe(false)
  })

  it('renders the incomplete pace chunk as a muted partial marker', async () => {
    const now = Math.floor(Date.now() / 1000)
    const brs = [22000, 46000, 1000]
    const totals = [2000, 4000, 4500]
    const brHistory = brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      return {
        brAfter,
        brPrev,
        date: `P${i + 1}`,
        timestamp: now - (3 - i) * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments: totals[i],
        tournaments: i === 0 ? totals[i] : totals[i] - totals[i - 1],
        text: `Pace session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...makeMockData().meta,
        brHistory,
        totalTournaments: 4500,
      },
    }))

    render(<App />)
    const widget = await screen.findByTestId('pace-widget')
    expect(within(widget).getAllByText('4.5k').length).toBeGreaterThanOrEqual(1)
    expect(widget.querySelector('.pace-segment.partial')).toBeInTheDocument()
    expect(widget.querySelector('.pace-dot-partial-ring')).toBeInTheDocument()
    expect(widget.querySelector('.pace-line.partial')).toBeInTheDocument()
    const plotLeft = Number(widget.querySelector('.pace-plot-bg')?.getAttribute('x'))
    const trendPath = widget.querySelector('.pace-trend-line')?.getAttribute('d')
    const trendCoords = trendPath?.match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/)
    const trendStart = trendPath?.match(/^M ([\d.]+) /)
    const fullDots = [...widget.querySelectorAll('.pace-segment:not(.partial) .pace-dot')]
    const lastFullDotX = Number(fullDots[fullDots.length - 1]?.getAttribute('cx'))
    const partialDotX = Number(widget.querySelector('.pace-segment.partial .pace-dot')?.getAttribute('cx'))
    expect(Number(trendStart?.[1])).toBeCloseTo(plotLeft, 1)
    expect(Number(trendCoords?.[3])).toBeCloseTo(lastFullDotX, 1)
    expect(Number(trendCoords?.[3])).toBeLessThan(partialDotX)
    expect(Number(trendCoords?.[4])).toBeLessThan(Number(trendCoords?.[2]))
    expect(widget.querySelector('.pace-trend.rising')).toBeInTheDocument()
  })

  it('recalculates the pace trend from full 2k chunks', async () => {
    const now = Math.floor(Date.now() / 1000)
    const totals = [2000, 4000, 6000]
    const buildHistory = brs => brs.map((brAfter, i) => {
      const brPrev = i === 0 ? 10000 : brs[i - 1]
      return {
        brAfter,
        brPrev,
        date: `T${i + 1}`,
        timestamp: now - (3 - i) * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments: totals[i],
        tournaments: i === 0 ? totals[i] : totals[i] - totals[i - 1],
        text: `Trend session ${i + 1}`,
      }
    })

    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...makeMockData().meta,
        brHistory: buildHistory([22000, 46000, 82000]),
        totalTournaments: 6000,
      },
    }))
    const { unmount } = render(<App />)
    const risingWidget = await screen.findByTestId('pace-widget')
    expect(risingWidget.querySelector('.pace-trend.rising')).toBeInTheDocument()

    unmount()
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...makeMockData().meta,
        brHistory: buildHistory([46000, 70000, 82000]),
        totalTournaments: 6000,
      },
    }))
    render(<App />)
    const fallingWidget = await screen.findByTestId('pace-widget')
    expect(fallingWidget.querySelector('.pace-trend.falling')).toBeInTheDocument()
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
    expect(labels.some(label => label?.includes('ВОРСТ'))).toBe(false)
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
    const mainLinePath = document.querySelector('.mc-line-main')?.getAttribute('d')
    expect(mainLinePath).toContain(' L ')
    expect(mainLinePath).not.toContain(' C ')
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
    const peakRect = peakCallout?.querySelector('.mc-peak-callout-bg')
    const peakLine = peakCallout?.querySelector('.mc-peak-callout-line')
    const peakAnchor = peakCallout?.querySelector('.mc-peak-anchor')
    const axisText = [...document.querySelectorAll('.mc-xaxis-label-main, .mc-xaxis-label-sub')]
      .map(label => label.textContent)
      .join(' ')
    expect(peakCallout).toHaveAttribute('data-idx', '3')
    expect(peakCallout?.textContent).toContain('ПИК')
    expect(peakCallout?.textContent).toContain('$140k')
    expect(Number(peakRect?.getAttribute('x'))).toBeGreaterThan(300)
    const peakBounds = {
      left: Number(peakRect?.getAttribute('x')) - 12,
      right: Number(peakRect?.getAttribute('x')) + Number(peakRect?.getAttribute('width')) + 12,
      top: Number(peakRect?.getAttribute('y')) - 12,
      bottom: Number(peakRect?.getAttribute('y')) + Number(peakRect?.getAttribute('height')) + 12,
    }
    const coveredDots = [...document.querySelectorAll('.mc-dot')].filter(dot => {
      const x = Number(dot.getAttribute('cx'))
      const y = Number(dot.getAttribute('cy'))
      return x >= peakBounds.left && x <= peakBounds.right && y >= peakBounds.top && y <= peakBounds.bottom
    })
    expect(coveredDots).toHaveLength(0)
    expect(Number(peakLine?.getAttribute('x1'))).toBeCloseTo(Number(peakAnchor?.getAttribute('cx')), 5)
    expect(Number(peakLine?.getAttribute('y1'))).toBeCloseTo(Number(peakAnchor?.getAttribute('cy')), 5)
    expect(Math.hypot(
      Number(peakLine?.getAttribute('x2')) - Number(peakLine?.getAttribute('x1')),
      Number(peakLine?.getAttribute('y2')) - Number(peakLine?.getAttribute('y1')),
    )).toBeLessThan(120)
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

  it('keeps adjacent best and worst marathon labels compact on one line', async () => {
    const base = makeMockData()
    const brs = [18000, 42000, 76000, 120000, 177800, 142600]
    const totals = [1000, 3500, 6500, 10000, 11700, 13957]
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
        totalTournaments: totals.at(-1),
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const bestLabel = document.querySelector('.mc-x-tick.best .mc-xaxis-label-main')
    const worstLabel = document.querySelector('.mc-x-tick.worst .mc-xaxis-label-main')

    expect(bestLabel?.textContent).toMatch(/^\+/)
    expect(worstLabel?.textContent).toBe('-35.2k$')
    expect(bestLabel?.getAttribute('y')).toBe(worstLabel?.getAttribute('y'))
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
    const markers = [...document.querySelectorAll('g[data-start][data-end]')]
    const latestMarker = markers[markers.length - 1]
    const previousMarker = markers[markers.length - 2]
    const latestDot = latestMarker?.querySelector('.mc-dot')
    const previousDot = previousMarker?.querySelector('.mc-dot')
    const previousAnchor = previousMarker?.querySelector('.mc-dot-cluster-hit') || previousMarker?.querySelector('.mc-dot')
    const previousClusterParts = previousMarker?.querySelectorAll('.mc-dot-cluster-part') || []
    const latestX = Number(latestDot?.getAttribute('cx'))
    const latestY = Number(latestDot?.getAttribute('cy'))
    const previousX = Number(previousAnchor?.getAttribute('cx'))
    const previousY = Number(previousAnchor?.getAttribute('cy'))
    expect(Number(latestMarker?.dataset.start)).toBe(brHistory.length - 1)
    expect(Number(latestMarker?.dataset.end)).toBe(brHistory.length - 1)
    expect(Number(latestMarker?.dataset.count)).toBe(1)
    expect(Number(previousMarker?.dataset.count)).toBeGreaterThan(1)
    if (previousClusterParts.length) {
      expect(previousClusterParts.length).toBeGreaterThan(1)
      expect(previousMarker?.querySelector('.mc-dot-compacted')).not.toBeInTheDocument()
    } else {
      expect(previousDot).toHaveClass('mc-dot-grouped')
    }
    expect(Math.hypot(latestX - previousX, latestY - previousY)).toBeGreaterThanOrEqual(20)
    expect(document.querySelectorAll('.mc-xlabel-bg')).toHaveLength(0)
    expect(document.querySelectorAll('.mc-ylabel-bg')).toHaveLength(0)
    expect(document.querySelectorAll('.mc-xaxis-label-main').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.mc-yaxis-label').length).toBeGreaterThan(0)

    const hoverTarget = previousMarker?.querySelector('circle[fill="transparent"]')
    expect(hoverTarget).toBeTruthy()
    fireEvent.mouseEnter(hoverTarget)
    expect(document.querySelector('.mc-session-breakdown')).toBeInTheDocument()
    expect(document.querySelectorAll('.mc-session-row').length).toBeGreaterThan(1)
  })

  it('splits dense mixed marathon clusters into small dots on the line', async () => {
    const base = makeMockData()
    const prefix = [
      [9954, 167], [8710, 385], [47815, 8803], [45727, 8957],
      [57156, 9274], [74610, 9772], [114175, 10600], [117838, 11335],
      [175660, 11502], [156363, 11647], [153715, 11799], [141345, 11935],
    ]
    const denseTail = [
      [131689, 12049], [125919, 12214], [122550, 12375], [127045, 12551],
      [176612, 12672], [190999, 12830], [186336, 12956], [157804, 13119],
      [173668, 13305], [188341, 13465], [186657, 13617], [175802, 13771],
      [140614, 13957], [158825, 14165], [135661, 14348], [146784, 14510],
      [146553, 14697], [145826, 14896], [149216, 15058], [140709, 15058],
      [155354, 15187], [140161, 15304], [143579, 15516], [152936, 15681],
      [175235, 15830], [170450, 15929], [156406, 16173], [156521, 16398],
      [204021, 16573], [203652, 16719], [199923, 16942],
    ]
    const rows = [...prefix, ...denseTail]
    const brHistory = rows.map(([brAfter, totalTournaments], i) => {
      const brPrev = i === 0 ? 10000 : rows[i - 1][0]
      return {
        brAfter,
        brPrev,
        date: `D${i + 1}`,
        timestamp: 1712300000 + i * 86400,
        sessionResult: brAfter - brPrev,
        totalTournaments,
        tournaments: i === 0 ? totalTournaments : Math.max(0, totalTournaments - rows[i - 1][1]),
        text: `Session ${i + 1}`,
      }
    })
    fetchPublicData.mockResolvedValue(makeMockData({
      meta: {
        ...base.meta,
        brHistory,
        totalTournaments: rows.at(-1)[1],
      },
    }))

    render(<App />)
    expect(await screen.findByText(new RegExp(translate('ru', 'chart_marathon').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()

    const splitCluster = [...document.querySelectorAll('.marathon-chart g[data-start][data-end]')]
      .find(marker => Number(marker.getAttribute('data-count')) >= 8 && marker.querySelector('.mc-dot-cluster-parts'))
    const clusterParts = splitCluster?.querySelectorAll('.mc-dot-cluster-part') || []
    expect(splitCluster).toBeTruthy()
    expect(clusterParts.length).toBeGreaterThanOrEqual(8)
    expect([...clusterParts].some(dot => dot.getAttribute('fill') === '#4caf50')).toBe(true)
    expect([...clusterParts].some(dot => dot.getAttribute('fill') === '#e53935')).toBe(true)
    expect(splitCluster?.querySelector('.mc-dot-compacted')).not.toBeInTheDocument()

    const mainLinePoints = parseLinearSvgPath(document.querySelector('.mc-line-main')?.getAttribute('d'))
    for (const dot of clusterParts) {
      const x = Number(dot.getAttribute('cx'))
      const y = Number(dot.getAttribute('cy'))
      const lineY = yOnLinearPath(mainLinePoints, x)
      expect(lineY).not.toBeNull()
      expect(Math.abs(y - lineY)).toBeLessThan(0.6)
    }
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
    const previousMarker = document.querySelector('g[data-end="4"]')
    const lastDot = lastMarker?.querySelector('.mc-dot')
    const previousDot = previousMarker?.querySelector('.mc-dot')
    const lastX = Number(lastDot?.getAttribute('cx'))
    const lastY = Number(lastDot?.getAttribute('cy'))
    const previousX = Number(previousDot?.getAttribute('cx'))
    const previousY = Number(previousDot?.getAttribute('cy'))
    expect(lastDot).toBeInTheDocument()
    expect(lastMarker?.dataset.count).toBe('1')
    expect(lastDot).toHaveClass('mc-dot-last')
    expect(lastDot).not.toHaveClass('mc-dot-crowded')
    expect(Math.hypot(lastX - previousX, lastY - previousY)).toBeGreaterThanOrEqual(20)

    const mainLinePoints = parseLinearSvgPath(document.querySelector('.mc-line-main')?.getAttribute('d'))
    for (const dot of [previousDot, lastDot]) {
      const x = Number(dot?.getAttribute('cx'))
      const y = Number(dot?.getAttribute('cy'))
      const lineY = yOnLinearPath(mainLinePoints, x)
      expect(lineY).not.toBeNull()
      expect(Math.abs(y - lineY)).toBeLessThan(0.6)
    }
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
    expect(document.querySelector('.topbar-tabs')?.tagName).toBe('NAV')
    expect(document.querySelector('main.page')).toBeInTheDocument()
  })

  it('does not render the topics section tab', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(document.querySelectorAll('.topbar-tab')).toHaveLength(2)
  })

  it('switches to the complete settings screen', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    fireEvent.click(screen.getAllByText(translate('ru', 'tab_settings'))[0])
    expect(screen.getByText(new RegExp(translate('ru', 'settings_ignored_authors')))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: new RegExp(translate('ru', 'settings_appearance')) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: new RegExp(translate('ru', 'settings_feed')) })).toBeInTheDocument()
    expect(screen.getByLabelText(translate('ru', 'settings_sort'))).toHaveValue('date_desc')
    expect(document.querySelector('.hero')).not.toBeInTheDocument()
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
    expect(screen.getAllByText('v1.12').length).toBeGreaterThanOrEqual(1)
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
    expect(screen.getByLabelText(translate('ru', 'filter_likes_from'))).toBeInTheDocument()
    expect(screen.getByLabelText(translate('ru', 'filter_reputation_from'))).toBeInTheDocument()
  })

  it('shows newest posts first by default', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')

    expect(screen.getByLabelText(translate('ru', 'filter_sort_label'))).toHaveValue('date_desc')
    const visiblePostText = [...document.querySelectorAll('.post-card .pc-body')]
      .map((node) => node.textContent)
    expect(visiblePostText.slice(0, 2)).toEqual([
      'Day #5 marathon. After session: 11000',
      'Interesting post about poker and Romeo.',
    ])
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

    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0])

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

  it('mounts the FirstFund banner once on desktop (no hidden duplicate)', async () => {
    fetchPublicData.mockResolvedValue(makeMockData())
    const { container } = render(<App />)
    await screen.findByTestId('pace-widget')
    // matchMedia reports not-narrow in tests, so only the sidebar banner mounts
    // (previously both the sidebar and the hidden mobile-slot copy rendered).
    expect(container.querySelectorAll('.ff-banner').length).toBe(1)
    expect(container.querySelector('.ff-banner-mobile-slot')).toBeNull()
    expect(container.querySelector('.topbar-join')).toBeNull()
    expect(screen.getByText(translate('ru', 'partner_label'))).toBeInTheDocument()
  })
})
