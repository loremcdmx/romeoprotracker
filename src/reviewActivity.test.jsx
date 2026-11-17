import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { translate, fmtDateShortLang } from './i18n.js'
import { fetchPublicData } from './storage.js'
import { warsawDayKey } from './utils.js'
import {
  buildActivityWindow, shiftDayKey, dayKeyTimestamp, topPostPreview,
} from './activityAuthors.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const viewport = vi.hoisted(() => ({ mobile: false }))
vi.mock('./hooks/useIsMobile.js', () => ({ useIsMobile: () => viewport.mobile }))

// Warsaw noon of a calendar day, UTC seconds (13:00 / 14:00 local depending on DST)
const noon = key => dayKeyTimestamp(key)
const iso = key => new Date(noon(key) * 1000).toISOString()

function byDateOf(keys) {
  const out = {}
  for (const k of keys) out[k] = { count: 1, posts: [{ timestamp: noon(k) }] }
  return out
}

function keysOf(win) { return win.map(([k]) => k) }

describe('activity chart windows are Warsaw calendar days', () => {
  it('keeps a quiet day on the axis (22 Oct 2026 between 21 and 23 Oct)', () => {
    const win = buildActivityWindow(byDateOf(['2026-10-21', '2026-10-23']), 'week', noon('2026-10-23'))
    expect(keysOf(win)).toEqual([
      '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
    ])
    expect(win.find(([k]) => k === '2026-10-22')[1].count).toBe(0)
  })

  it('month = today and the 29 days before it, week = today and the 6 before', () => {
    const by = byDateOf(['2026-10-21', '2026-11-16'])
    const month = buildActivityWindow(by, 'month', noon('2026-11-16'))
    expect(month).toHaveLength(30)
    expect(month[0][0]).toBe('2026-10-18')
    expect(month.at(-1)[0]).toBe('2026-11-16')
    const week = buildActivityWindow(by, 'week', noon('2026-11-16'))
    expect(keysOf(week)[0]).toBe('2026-11-10')
    expect(week).toHaveLength(7)
  })

  it('all = first post day .. today with empty days between', () => {
    const win = buildActivityWindow(byDateOf(['2026-03-10', '2026-03-13']), 'all', noon('2026-03-15'))
    expect(keysOf(win)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'])
    expect(win.map(([, v]) => v.count)).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('autumn DST (25 Oct 2026, 25 hours) is exactly one bar', () => {
    const win = buildActivityWindow(byDateOf(['2026-10-25']), 'week', noon('2026-10-27'))
    expect(keysOf(win)).toEqual([
      '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
    ])
    const month = buildActivityWindow(byDateOf(['2026-10-25']), 'month', noon('2026-11-05'))
    expect(month).toHaveLength(30)
    expect(new Set(keysOf(month)).size).toBe(30)
  })

  it('spring DST (29 Mar 2026, 23 hours) is exactly one bar', () => {
    const win = buildActivityWindow(byDateOf(['2026-03-29']), 'week', noon('2026-04-01'))
    expect(keysOf(win)).toEqual([
      '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01',
    ])
    const all = buildActivityWindow(byDateOf(['2026-03-27', '2026-03-29']), 'all', noon('2026-03-30'))
    expect(keysOf(all)).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'])
  })

  it('"now" in the last minutes of a DST day still lands on that Warsaw day', () => {
    // 25 Oct 2026 23:30 Warsaw = 22:30 UTC (CET); 29 Mar 2026 23:30 Warsaw = 21:30 UTC (CEST)
    const a = buildActivityWindow(byDateOf(['2026-10-25']), 'week', Date.UTC(2026, 9, 25, 22, 30) / 1000)
    expect(a.at(-1)[0]).toBe('2026-10-25')
    const b = buildActivityWindow(byDateOf(['2026-03-29']), 'week', Date.UTC(2026, 2, 29, 21, 30) / 1000)
    expect(b.at(-1)[0]).toBe('2026-03-29')
  })

  it('crosses a year boundary without losing or doubling a day', () => {
    const win = buildActivityWindow(byDateOf(['2026-12-31', '2027-01-02']), 'week', noon('2027-01-03'))
    expect(keysOf(win)).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ])
    expect(shiftDayKey('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29')
    // the labels of such a range carry the short year
    expect(fmtDateShortLang(noon('2027-01-01'), 'ru', true)).toBe('1 янв 27')
  })

  it('returns nothing without posts and keeps every post day when a post is dated after today', () => {
    expect(buildActivityWindow({}, 'month', noon('2026-11-16'))).toEqual([])
    const win = buildActivityWindow(byDateOf(['2026-11-18']), 'week', noon('2026-11-16'))
    expect(win.at(-1)[0]).toBe('2026-11-18')
  })
})

describe('topPostPreview', () => {
  it('says "📷 image" for an image-only post and collapses whitespace runs', () => {
    expect(topPostPreview({ text: '', images: ['https://x/y.jpg'] }, 'изображение')).toBe('📷 изображение')
    expect(topPostPreview({ text: 'Day 51:   40:\n\n  x', images: [] }, 'изображение')).toBe('Day 51: 40: x')
    expect(topPostPreview({ text: '[QUOTE]a[/QUOTE]', images: ['https://x/y.jpg'] }, 'изображение')).toBe('')
    expect(topPostPreview({ text: '', images: [] }, 'изображение')).toBe('')
  })
})

// ── component level ─────────────────────────────────────────────────────────
const NOW_KEY = '2026-10-23'
const post = (id, key, extra = {}) => ({
  id, author: `User${id}`, text: `post ${id}`, likes: 5, timestamp: noon(key) , date: 'x',
  avatar: null, rating: 1000, msgCount: 1, regData: '2024', brAfter: null, images: [],
  url: `https://forum.gipsyteam.ru/${id}`, ...extra,
})
function data(posts) {
  return {
    posts,
    meta: {
      startBankroll: 10000, targetBankroll: 10000000, bankroll: 12000, day: 7, totalTournaments: 100,
      brHistory: [], lastUpdated: '2026-10-23T00:00:00.000Z',
    },
    leaderboards: null,
  }
}

describe('activity chart and top lists in the app', () => {
  beforeEach(() => {
    viewport.mobile = false
    localStorage.clear()
    fetchPublicData.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 23, 10, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('desktop month view: 30 bars, the quiet day is an empty non-interactive bar, labels are localized dates', async () => {
    fetchPublicData.mockResolvedValue(data([post('1', '2026-10-21'), post('2', '2026-10-23')]))
    render(<App />)
    const heading = await screen.findByText(translate('ru', 'chart_activity'))
    const chart = heading.closest('.chart-wrap')
    expect(chart.querySelectorAll('.activity-bar-rect')).toHaveLength(30)
    const gap = chart.querySelector('g.activity-gap[aria-label^="2026-10-22"]')
    expect(gap).toBeTruthy()
    expect(gap.getAttribute('aria-label')).toContain(translate('ru', 'activity_no_posts'))
    expect(gap.querySelector('rect').getAttribute('height')).toBe('0')
    expect(gap.getAttribute('role')).toBe('img')
    // no tooltip and no selection on a quiet day
    fireEvent.mouseEnter(gap)
    fireEvent.click(gap)
    await new Promise(r => setTimeout(r, 150))
    expect(document.querySelector('.chart-tooltip')).toBeNull()
    expect(chart.querySelector('.activity-bar[aria-pressed="true"]')).toBeNull()
    // labels read like every other date on the page, never "10-17"
    const labels = [...chart.querySelectorAll('.chart-label')].map(n => n.textContent)
    expect(labels.length).toBeGreaterThan(2)
    for (const l of labels) {
      expect(l).not.toMatch(/^\d\d-\d\d$/)
      expect(l).toMatch(/^\d{1,2} (янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)$/)
    }
    // the caption keeps counting days
    expect(chart.querySelector('.section-count').textContent).toContain('30')
  })

  it('tooltip and selected-day panel show the localized date', async () => {
    fetchPublicData.mockResolvedValue(data([post('1', '2026-10-21'), post('2', '2026-10-23')]))
    render(<App />)
    const heading = await screen.findByText(translate('ru', 'chart_activity'))
    const chart = heading.closest('.chart-wrap')
    const bar = chart.querySelector('.activity-bar[aria-label^="2026-10-21"]')
    fireEvent.click(bar)
    expect(chart.textContent).toContain('21 окт')
    expect(chart.textContent).not.toContain('2026-10-21')
  })

  it('a range across two calendar years adds the short year to the labels', async () => {
    vi.setSystemTime(Date.UTC(2027, 0, 5, 10, 0))
    fetchPublicData.mockResolvedValue(data([post('1', '2026-12-31'), post('2', '2027-01-02')]))
    render(<App />)
    const heading = await screen.findByText(translate('ru', 'chart_activity'))
    const chart = heading.closest('.chart-wrap')
    const labels = [...chart.querySelectorAll('.chart-label')].map(n => n.textContent)
    expect(labels.every(l => /\d{2}$/.test(l) && l.split(' ').length === 3)).toBe(true)
  })

  it('phone chart: quiet day is an empty marker, bars use the shared bar class, dates are localized', async () => {
    viewport.mobile = true
    fetchPublicData.mockResolvedValue(data([post('1', '2026-10-21'), post('2', '2026-10-23')]))
    render(<App />)
    const heading = await screen.findByText(translate('ru', 'chart_activity'))
    const chart = heading.closest('.chart-wrap')
    expect(chart.querySelectorAll('.activity-mobile-bar')).toHaveLength(30)
    expect(chart.querySelectorAll('.activity-mobile-bar.empty').length).toBe(28)
    const gap = chart.querySelector('.activity-mobile-gap[aria-label^="2026-10-22"]')
    expect(gap).toBeTruthy()
    expect(gap.getAttribute('role')).toBe('img')
    const dates = [...chart.querySelectorAll('.activity-mobile-date')].map(n => n.textContent)
    expect(dates).toContain('22 окт')
    expect(dates.some(d => /^\d\d-\d\d$/.test(d))).toBe(false)
    fireEvent.click(chart.querySelector('[role="button"][aria-label^="2026-10-21"]'))
    expect(chart.textContent).toContain('21 окт')
  })

  it('top list: a period without posts says so instead of showing the all-time list (desktop sidebar)', async () => {
    fetchPublicData.mockResolvedValue(data([post('1', '2026-10-20', { likes: 9, text: 'old hot post' })]))
    render(<App />)
    await screen.findByText(translate('ru', 'chart_activity'))
    const head = document.querySelector('.forum-top-head')
    expect(head).toBeTruthy()
    // all-time shows the post
    expect(document.querySelector('[data-testid="sidebar-top-item-0"]')).toBeTruthy()
    fireEvent.click(within(head).getByRole('button', { name: translate('ru', 'filter_day') }))
    expect(document.querySelector('[data-testid="sidebar-top-item-0"]')).toBeNull()
    expect(document.querySelector('.forum-top-empty').textContent).toBe(translate('ru', 'top_period_empty'))
    expect(document.querySelector('.sidebar').textContent).not.toContain('old hot post')
  })

  it('top list (phone): same honest empty line, and an image-only post reads "📷 изображение"', async () => {
    viewport.mobile = true
    fetchPublicData.mockResolvedValue(data([
      post('1', '2026-10-20', { likes: 9, text: '', images: ['https://example.com/i.jpg'] }),
      post('2', '2026-10-20', { likes: 8, text: 'Day 51:   40:' }),
    ]))
    render(<App />)
    await screen.findByText(translate('ru', 'chart_activity'))
    const list = document.querySelector('.mobile-top-list')
    const texts = [...list.querySelectorAll('.mobile-top-text')].map(n => n.textContent)
    expect(texts).toEqual([`📷 ${translate('ru', 'image_caption')}`, 'Day 51: 40:'])
    expect(texts.join('')).not.toContain('→')
    const head = document.querySelector('.mobile-top-header')
    fireEvent.click(within(head).getByRole('button', { name: translate('ru', 'filter_day') }))
    expect(document.querySelector('.mobile-top-empty').textContent).toBe(translate('ru', 'top_period_empty'))
    expect(document.querySelectorAll('.mobile-top-item')).toHaveLength(0)
  })

  it('every image of the sidebar top list and of the day thumbnails is lazy and async', async () => {
    fetchPublicData.mockResolvedValue(data([
      post('1', '2026-10-22', { likes: 9, images: ['https://example.com/i.jpg'], avatar: 'https://example.com/a.jpg' }),
    ]))
    render(<App />)
    await screen.findByText(translate('ru', 'chart_activity'))
    const imgs = document.querySelectorAll('[data-testid^="sidebar-top-item-"] img')
    expect(imgs.length).toBeGreaterThanOrEqual(2)
    for (const img of imgs) {
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('decoding')).toBe('async')
    }
  })

  it('i18n keys exist in all three languages', () => {
    for (const lang of ['ru', 'en', 'es']) {
      expect(translate(lang, 'activity_no_posts')).not.toBe('activity_no_posts')
      expect(translate(lang, 'top_period_empty')).not.toBe('top_period_empty')
    }
    expect(warsawDayKey(noon(NOW_KEY))).toBe(NOW_KEY)
    expect(iso(NOW_KEY)).toMatch(/T12:00:00/)
  })
})
