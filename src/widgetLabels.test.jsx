import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import MonthlyMarathonChart from './components/MonthlyMarathonChart.jsx'
import { createTranslator, translate } from './i18n.js'
import { normalizeMarathonDistance } from './marathonMonths.js'
import { fetchPublicData } from './storage.js'
import { dedupBrHistory, fmtDateTimeLang, fmtExactSigned, plural } from './utils.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const DAY = 86400
const REAL_META = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/meta.json'), 'utf8'))
const clone = value => structuredClone(value) // keeps NaN / Infinity, unlike JSON
const digits = text => Number(String(text).replace(/\D/g, ''))
const squash = text => String(text || '').replace(/\s/g, '')
const nowSec = () => Math.floor(Date.now() / 1000)

function mockNow(seconds) {
  vi.spyOn(Date, 'now').mockReturnValue(seconds * 1000)
}

async function mount(data, { lang = 'ru', ls = {} } = {}) {
  localStorage.clear()
  localStorage.setItem('rpt_lang', lang)
  for (const [key, value] of Object.entries(ls)) localStorage.setItem(key, value)
  fetchPublicData.mockReset()
  fetchPublicData.mockResolvedValue(clone(data))
  const view = render(<App />)
  await waitFor(() => expect(document.querySelector('.marathon-chart')).toBeTruthy())
  return view
}

// sessions: [{ tournaments, profit, ts }]; cumulative totals are exact unless `total` overrides one
function metaFrom(sessions, { startBankroll = 10000 } = {}) {
  let br = startBankroll
  let total = 0
  const brHistory = sessions.map((s, i) => {
    const brBefore = br
    br += s.profit
    total += s.tournaments
    return {
      id: `s${i}`, timestamp: s.ts, date: `D${i}`, brBefore, brAfter: br, sessionResult: s.profit,
      tournaments: s.tournaments, totalTournaments: s.total ?? total,
      text: `Session ${i}`, url: `https://example.com/s${i}`,
    }
  })
  return { startBankroll, bankroll: br, totalTournaments: total, brHistory, lastUpdated: '2026-04-07T10:05:00.000Z', totalPosts: 0 }
}

const realData = () => ({ posts: [], meta: clone(REAL_META) })
const dedupedReal = () => dedupBrHistory(clone(REAL_META.brHistory))
const lastRealTs = () => Math.max(...REAL_META.brHistory.map(row => row.timestamp))

afterEach(() => { vi.restoreAllMocks() })
beforeEach(() => { localStorage.clear() })

describe('new i18n keys exist in every language', () => {
  const KEYS = ['chart_no_reports_period', 'pace_empty_period', 'mtt_unit_singular', 'pace_trend_note']
  it.each(KEYS)('%s', key => {
    const values = ['ru', 'en', 'es'].map(lang => translate(lang, key))
    values.forEach(value => { expect(value).toBeTruthy(); expect(value).not.toBe(key) })
  })
})

// ─── DL-3 / PH-3: one definition of "MTT per session" ────────────────────────
describe('MTT per session is one number on one screen', () => {
  // independent oracle: average of the positive cumulative deltas, same window rule as the chart
  function oracle(period, atSec) {
    const hist = dedupedReal()
    let prev = 0
    const rows = []
    hist.forEach((row, i) => {
      const delta = i === 0 ? (row.tournaments || row.totalTournaments) : Math.max(0, row.totalTournaments - prev)
      prev = row.totalTournaments
      if (delta > 0) rows.push({ ts: row.timestamp, delta })
    })
    let used = rows
    if (period !== 'all') {
      const cutoff = atSec - (period === 'week' ? 7 : 30) * DAY
      const inside = rows.filter(r => r.ts >= cutoff)
      if (inside.length >= 2) used = inside
    }
    return Math.round(used.reduce((sum, r) => sum + r.delta, 0) / used.length)
  }
  const flatRow = id => dedupedReal().find(row => row.id === id)

  const SCENARIOS = [
    ['all time', 'all', () => nowSec()],
    ['a week containing a flat-cumulative report', 'week', () => flatRow('8287288').timestamp + 2 * DAY],
    ['a month containing a flat-cumulative report', 'month', () => flatRow('8270206').timestamp + 3 * DAY],
  ]

  it.each(SCENARIOS)('sidebar, mobile strip and session chart agree: %s', async (_label, period, at) => {
    // sanity: the archive really holds flat-cumulative reports (counter did not move)
    const hist = dedupedReal()
    expect(hist.filter((row, i) => i > 0 && row.totalTournaments === hist[i - 1].totalTournaments).length).toBeGreaterThanOrEqual(3)
    mockNow(at())
    await mount(realData(), { ls: { rpt_chart_period: period } })

    const expected = oracle(period, at())
    const sidebarRow = [...document.querySelectorAll('.sblock .srow')]
      .find(row => row.querySelector('.srow-key')?.textContent.startsWith(translate('ru', 'sr_avg')))
    const mobileStat = [...document.querySelectorAll('.mobile-stat')]
      .find(stat => stat.querySelector('.mobile-stat-label')?.textContent.startsWith(translate('ru', 'sr_avg')))
    const chart = await screen.findByTestId('session-mtt-widget')
    const chip = digits(chart.querySelector('.smtt-avg-chip').textContent)
    const tick = digits(chart.querySelector('.smtt-avg-tick').textContent)

    expect(digits(sidebarRow.querySelector('.srow-val').textContent)).toBe(expected)
    expect(digits(mobileStat.querySelector('.mobile-stat-value').textContent)).toBe(expected)
    expect(chip).toBe(expected)
    expect(tick).toBe(expected)
  })
})

// ─── PH-1 / PH-6: the trend note tells the truth ─────────────────────────────
describe('trend note matches the maths (completed steps only)', () => {
  function trendData(tailProfit) {
    const t0 = nowSec() - 6 * DAY
    return { posts: [], meta: metaFrom([
      { tournaments: 2000, profit: 3000, ts: t0 },
      { tournaments: 2000, profit: 6000, ts: t0 + DAY },
      { tournaments: 2000, profit: 2000, ts: t0 + 2 * DAY },
      { tournaments: 300, profit: tailProfit, ts: t0 + 3 * DAY },
    ]) }
  }
  const NOTE = { ru: /только по полным шагам/, en: /completed steps only/, es: /solo pasos completos/ }

  it.each(['ru', 'en', 'es'])('%s: the value ignores the partial tail and the note says so', async lang => {
    const first = await mount(trendData(50000), { lang })
    const read = () => {
      const card = document.querySelector('.pace-trend-item')
      return { value: card.querySelector('.mps-value').textContent, note: card.querySelector('.pace-summary-note').textContent }
    }
    const high = read()
    expect(high.note).toMatch(NOTE[lang])
    expect(high.note).not.toMatch(/неполн|partial|parcial/i)
    first.unmount()
    await mount(trendData(-50000), { lang })
    expect(read().value).toBe(high.value)
  })
})

// ─── I18N-4 / MC-4: monthly captions ─────────────────────────────────────────
describe('monthly chart captions', () => {
  const ts = iso => Date.parse(iso) / 1000
  const points = () => normalizeMarathonDistance([
    { id: 'a', timestamp: ts('2026-03-20T12:00:00Z'), br: 8000, brPrev: 10000, totalTournaments: 500 },
    { id: 'b', timestamp: ts('2026-04-20T12:00:00Z'), br: 20000, brPrev: 8000, totalTournaments: 1700 },
    { id: 'c', timestamp: ts('2026-05-10T12:00:00Z'), br: 21000, brPrev: 20000, totalTournaments: 2100 },
  ])
  const renderChart = (lang, extra = {}) => render(
    <MonthlyMarathonChart allPoints={points()} period="all" setPeriod={() => {}} grouping="months"
      setGrouping={() => {}} lang={lang} t={createTranslator(lang)} light={false} {...extra}/>,
  )

  it.each([['en', 'Per month'], ['es', 'Por mes'], ['ru', 'За месяц']])('%s: a closed month is not called "this month"', (lang, expected) => {
    const { container } = renderChart(lang)
    fireEvent.click(container.querySelector('[data-month-key="2026-03"]'))
    const caption = container.querySelector('.mc-month-svg .mc-distance-caption').textContent
    const labels = [...container.querySelectorAll('.mc-month-details dt')].map(el => el.textContent)
    expect(caption).toContain(expected)
    expect(labels).toContain(expected)
    expect(caption + labels.join('|')).not.toMatch(/This month|Este mes/)
  })

  it.each(['ru', 'en', 'es'])('%s: the month slice and the window total never share one caption', lang => {
    mockNow(ts('2026-05-15T12:00:00Z'))
    const t = createTranslator(lang)
    const { container } = renderChart(lang, { period: 'month' })
    fireEvent.click(container.querySelector('[data-month-key="2026-04"]'))
    const labels = [...container.querySelectorAll('.mc-month-details dt')].map(el => el.textContent)
    const summary = container.querySelector('.mc-distance-summary').textContent
    expect(labels).toContain(t('chart_month_distance_filtered'))
    expect(labels).not.toContain(t('chart_period_distance'))
    expect(summary.startsWith(t('chart_period_distance'))).toBe(true)
  })
})

// ─── I18N-6: singular rate unit ──────────────────────────────────────────────
describe('rate unit is singular, counts keep their plural label', () => {
  it.each([['en', 'MTT'], ['es', 'MTT'], ['ru', 'МТТ']])('%s: +x$/%s everywhere a rate is shown', async (lang, unit) => {
    await mount(realData(), { lang })
    const html = document.body.innerHTML
    expect(html).not.toMatch(/\$\/MTTs/)
    const rate = new RegExp(`^[+-]?[\\d.]+\\$/${unit}$`)
    expect(document.querySelector('.pace-rate-item .mps-value').textContent).toMatch(rate)
    expect(document.querySelector('.marathon-progress .mps-rate-inline').textContent).toMatch(rate)
    const note = document.querySelector('.pace-rate-item .pace-summary-note').textContent
    expect(note).toContain(translate(lang, 'sr_mtt_short'))
  })
})

// ─── I18N-7: dates ───────────────────────────────────────────────────────────
describe('dates', () => {
  const stamp = Date.parse('2026-04-07T10:03:00Z') / 1000 // 12:03 in Warsaw (CEST)
  it('Spanish dates take "de" between day and month, other languages are unchanged', () => {
    expect(fmtDateTimeLang(stamp, 'es')).toBe('7 de abril, 12:03')
    expect(fmtDateTimeLang(stamp, 'en')).toBe('7 April, 12:03')
    expect(fmtDateTimeLang(stamp, 'ru')).toBe('7 апреля, 12:03')
  })

  it.each(['ru', 'en', 'es'])('%s: footer date is zero-padded DD.MM and the hero date is grammatical', async lang => {
    const meta = { ...metaFrom([{ tournaments: 100, profit: 1000, ts: stamp }]), lastScrapeRun: '2026-04-07T10:05:00.000Z' }
    const posts = [{ id: 'p1', author: 'Romeopro', text: 'Day 5', likes: 9, timestamp: stamp, images: [], url: 'u', brAfter: 11000 }]
    await mount({ posts, meta }, { lang })
    await waitFor(() => expect(document.querySelector('.footer-fresh')).toBeTruthy())
    const footer = document.querySelector('.footer-fresh').textContent
    expect(footer).toMatch(/\b07\.04\b/)
    expect(footer).not.toMatch(/(^|\D)7\.4(\D|$)/)
    expect(footer).toContain('12:05')
    if (lang === 'es') expect(document.querySelector('.hero-desc').textContent).toContain('7 de abril, 12:03')
  })
})

// ─── PH-8: Russian plural of the projection unit ─────────────────────────────
describe('projection unit follows the Russian plural', () => {
  // one session at exactly +1$/MTT, so the finish projection equals the remaining dollars
  const dataFor = profit => ({ posts: [], meta: metaFrom([{ tournaments: profit, profit, ts: nowSec() - DAY }]) })
  it.each([
    [999, 9989001, 'турнир'],
    [998, 9989002, 'турнира'],
    [995, 9989005, 'турниров'],
    [989, 9989011, 'турниров'],
  ])('profit %i -> ~%i %s', async (profit, finish, word) => {
    await mount(dataFor(profit))
    const text = squash(document.querySelector('[data-testid="pace-widget"] .pace-projection-item .tempo-val').textContent)
    expect(text).toBe(`~${finish}${word}`)
    expect(plural(finish, ['турнир', 'турнира', 'турниров'])).toBe(word)
  })

  it('English keeps the MTTs unit', async () => {
    await mount(dataFor(998), { lang: 'en' })
    expect(squash(document.querySelector('.pace-projection-item .tempo-val').textContent)).toBe('~9989002MTTs')
  })
})

// ─── DL-4: the partial tail never repeats the previous chunk's label ─────────
describe('pace chunk labels', () => {
  it('a partial tail a few MTT past a boundary gets its own label', async () => {
    const t0 = nowSec() - 2 * DAY
    const meta = metaFrom([
      { tournaments: 5000, profit: 100, ts: t0 },
      { tournaments: 4, profit: 1, ts: t0 + DAY },
    ])
    await mount({ posts: [], meta }, { ls: { rpt_pace_bin_size: '5000' } })
    const segments = [...document.querySelectorAll('[data-testid="pace-chart"] .pace-segment')]
    expect(segments).toHaveLength(2)
    const labels = segments.map(seg => seg.getAttribute('aria-label').split(':')[0])
    expect(labels).toEqual(['5k', '5.004k'])
    const axis = [...document.querySelectorAll('[data-testid="pace-chart"] .pace-x-label')].map(el => el.textContent)
    expect(new Set(axis).size).toBe(axis.length)
    expect(axis).toContain('5.004k')
  })

  it('labels that were already distinct stay as they were', async () => {
    const t0 = nowSec() - 2 * DAY
    const meta = metaFrom([
      { tournaments: 2000, profit: 100, ts: t0 },
      { tournaments: 2000, profit: 100, ts: t0 + DAY },
      { tournaments: 500, profit: 10, ts: t0 + 2 * DAY },
    ])
    await mount({ posts: [], meta })
    const labels = [...document.querySelectorAll('[data-testid="pace-chart"] .pace-segment')].map(seg => seg.getAttribute('aria-label').split(':')[0])
    expect(labels).toEqual(['2k', '4k', '4.5k'])
  })
})

// ─── PH-5: one bad cumulative total must not move the pace numbers ───────────
describe('a mis-read cumulative total is ignored by the pace widget', () => {
  const sessions = () => Array.from({ length: 10 }, (_, i) => ({ tournaments: 100, profit: 100, ts: nowSec() - (10 - i) * DAY }))
  const read = () => ({
    note: squash(document.querySelector('.pace-rate-item .pace-summary-note').textContent),
    rate: document.querySelector('.pace-rate-item .mps-value').textContent,
    finish: squash(document.querySelector('.pace-projection-item .tempo-val').textContent),
  })

  it('reference run: the clean series sums to the hero total', async () => {
    await mount({ posts: [], meta: metaFrom(sessions()) })
    expect(read().note).toContain('/1000МТТ')
    expect(read().rate).toBe('+1$/МТТ')
  })

  it.each([
    ['too high', 50000],
    ['too low', 40],
    ['not a number', 'n/a'],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('%s', async (_label, bad) => {
    const rows = sessions()
    rows[4].total = bad
    const meta = metaFrom(rows) // exact totals everywhere but the bad one
    await mount({ posts: [], meta })
    const { note, rate } = read()
    expect(note).toContain('/1000МТТ')
    expect(rate).toBe('+1$/МТТ')
    expect(document.body.textContent).not.toMatch(/NaN/)
  })
})

// ─── MC-5 / PH-4: the selected month survives a refresh ──────────────────────
describe('monthly chart selection', () => {
  const ts = iso => Date.parse(iso) / 1000
  const base = () => [
    { id: 'a', timestamp: ts('2026-03-20T12:00:00Z'), br: 8000, brPrev: 10000, totalTournaments: 500 },
    { id: 'b', timestamp: ts('2026-04-20T12:00:00Z'), br: 20000, brPrev: 8000, totalTournaments: 1700 },
    { id: 'c', timestamp: ts('2026-05-10T12:00:00Z'), br: 21000, brPrev: 20000, totalTournaments: 2100 },
  ]
  const chart = points => (
    <MonthlyMarathonChart allPoints={normalizeMarathonDistance(points)} period="all" setPeriod={() => {}} grouping="months"
      setGrouping={() => {}} lang="en" t={createTranslator('en')} light={false}/>
  )
  const selected = container => container.querySelector('[data-testid="marathon-month-details"]').getAttribute('data-month-key')

  it('keeps the month when the same data arrives as new objects, drops it once the month is gone', () => {
    const { container, rerender } = render(chart(base()))
    expect(selected(container)).toBe('2026-05')
    fireEvent.click(container.querySelector('[data-month-key="2026-03"]'))
    expect(selected(container)).toBe('2026-03')

    rerender(chart(base())) // a poll delivered an equal payload
    expect(selected(container)).toBe('2026-03')

    rerender(chart(base().slice(1))) // March disappeared
    expect(selected(container)).toBe('2026-05')
    rerender(chart(base())) // and coming back does not resurrect the old pick
    expect(selected(container)).toBe('2026-05')
  })

  it('survives a likes-only refresh in the full app', async () => {
    const posts = [{ id: '1', author: 'Romeopro', text: 'Day 1', likes: 5, timestamp: 1773236621, date: 'x', images: [], url: 'u' }]
    await mount({ posts, meta: clone(REAL_META) }, { ls: { rpt_marathon_grouping: 'months' } })
    const read = () => document.querySelector('[data-testid="marathon-month-details"]').getAttribute('data-month-key')
    fireEvent.click(document.querySelectorAll('.mc-month-mark')[1])
    expect(read()).toBe('2026-04')
    const callsBefore = fetchPublicData.mock.calls.length
    fetchPublicData.mockResolvedValue({ posts: [{ ...posts[0], likes: 6 }], meta: clone(REAL_META) })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(fetchPublicData.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(read()).toBe('2026-04')
  })
})

// ─── MC-3 / E2E-8 / DL-2 / PH-2: a period without reports ────────────────────
describe('a week or month without any report', () => {
  const afterBreak = days => lastRealTs() + days * DAY

  it.each([['week', 9], ['month', 40]])('monthly chart (%s) says there are no reports, not "run the scraper"', async (period, gap) => {
    mockNow(afterBreak(gap))
    await mount(realData(), { ls: { rpt_chart_period: period, rpt_marathon_grouping: 'months' } })
    const chartText = document.querySelector('[data-testid="marathon-monthly-chart"]').textContent
    expect(chartText).toContain(translate('ru', 'chart_no_reports_period'))
    expect(chartText).not.toContain(translate('ru', 'empty_data_scraper'))
    expect(screen.getByTestId('marathon-monthly-chart').querySelectorAll('.mc-period').length).toBe(3)
  })

  it('a really empty archive still asks for the scraper', () => {
    const { container } = render(
      <MonthlyMarathonChart allPoints={[]} period="week" setPeriod={() => {}} grouping="months"
        setGrouping={() => {}} lang="ru" t={createTranslator('ru')} light={false}/>)
    expect(container.textContent).toContain(translate('ru', 'empty_data_scraper'))
  })

  it.each([['week', 9], ['month', 40]])('pace widget (%s) stays with its switch and explains itself', async (period, gap) => {
    mockNow(afterBreak(gap))
    await mount(realData(), { ls: { rpt_chart_period: period } })
    const widget = await screen.findByTestId('pace-widget')
    expect(widget).toHaveAttribute('data-empty', 'true')
    expect(widget.textContent).toContain(translate('ru', 'pace_empty_period'))
    const buttons = [...widget.querySelectorAll('.pace-periods .mc-period')]
    expect(buttons).toHaveLength(3)
    expect(buttons.find(b => b.getAttribute('aria-pressed') === 'true').textContent).toBe(translate('ru', `period_${period}`))
    // the progress bar keeps its tempo slot instead of silently dropping it
    const bar = document.querySelector('.marathon-progress')
    expect(bar.textContent).toContain(translate('ru', `tempo_${period}`))
    expect(bar.textContent).toContain('—')

    fireEvent.click(within(widget).getByText(translate('ru', 'period_all')))
    await waitFor(() => expect(screen.getByTestId('pace-widget')).not.toHaveAttribute('data-empty'))
    expect(document.querySelector('[data-testid="pace-widget"] .pace-rate-item')).toBeTruthy()
    expect(document.querySelector('.marathon-progress .tempo-val')).toBeTruthy()
  })
})

// ─── DL-1: reports without a usable bankroll ─────────────────────────────────
describe('malformed bankroll reports do not poison the page', () => {
  const sortedReal = () => clone(REAL_META.brHistory).sort((a, b) => a.timestamp - b.timestamp)
  const previousBr = () => sortedReal().at(-2).brAfter

  const VARIANTS = {
    'newest brAfter null': meta => { const last = meta.brHistory.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)); last.brAfter = null; last.sessionResult = null },
    'newest brAfter omitted': meta => { const last = meta.brHistory.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)); delete last.brAfter; delete last.sessionResult },
    'newest brAfter formatted string': meta => { const last = meta.brHistory.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)); last.brAfter = '$436,927' },
    'newest brAfter NaN': meta => { const last = meta.brHistory.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)); last.brAfter = NaN },
  }

  it.each(Object.keys(VARIANTS))('%s: the hero shows the last good report, the progress bar stays', async name => {
    const meta = clone(REAL_META)
    VARIANTS[name](meta)
    meta.bankroll = null // the scraper copies the newest brAfter here
    await mount({ posts: [], meta })
    const hero = document.querySelector('.hero-stats').textContent
    // the BR counter animates from the start value; the profit is exact at once
    expect(hero).toContain(`Профит${fmtExactSigned(previousBr() - 10000)}`)
    expect(hero).not.toMatch(/NaN/)
    const meter = document.querySelector('.marathon-progress [role="meter"]')
    expect(meter).toBeTruthy()
    expect(Number.isFinite(Number(meter.getAttribute('aria-valuenow')))).toBe(true)
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('a mid-history report without brAfter does not turn the chart path into NaN', async () => {
    const meta = clone(REAL_META)
    delete meta.brHistory[60].brAfter
    await mount({ posts: [], meta })
    const mainPath = document.querySelector('.mc-line-main').getAttribute('d')
    expect(mainPath).toBeTruthy()
    expect(mainPath).not.toMatch(/NaN/)
  })

  it('the untouched archive, flat reports included, renders exactly as before', async () => {
    await mount(realData())
    const hero = document.querySelector('.hero-stats').textContent
    expect(hero).toContain(`Профит${fmtExactSigned(sortedReal().at(-1).brAfter - 10000)}`)
    expect(document.querySelectorAll('.smtt-bar').length).toBe(
      dedupedReal().filter((row, i, all) => i === 0 || row.totalTournaments > all[i - 1].totalTournaments).length,
    )
  })
})
