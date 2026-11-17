// scrollToJumpTarget / settleOnJumpTarget (src/App.jsx): after a smooth in-page jump the app waits for the
// page to hold still and re-asks for the same place instantly. App.test.jsx pins the happy path and the
// "wheel" and "newer jump" exits; this file pins the rest of the contract, one behaviour per test:
//   - every reader input (wheel, touchstart, pointerdown, keydown) ends the settle,
//   - a target that left the DOM ends it,
//   - it never snaps more than SETTLE_MAX_SNAPS (4) times, even if every snap moves the page,
//   - it gives up after SETTLE_MAX_MS (5 s) when the page never holds still,
//   - when it ends it removes its window listeners again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'
import { warsawDayKey } from './utils.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown']
const now = Math.floor(Date.now() / 1000)
const mkPost = (id, author, over = {}) => ({
  id, author, text: `text of ${id}`, likes: 10, timestamp: now - 3600, date: 'x', avatar: null,
  rating: 1000, msgCount: 10, regData: '2021', images: [], url: `https://forum.gipsyteam.ru/${id}`, ...over,
})
// a Romeo report ten days back that sits on feed page 3 behind 40 newer posts
const oldDay = now - 10 * 86400
const fillers = Array.from({ length: 40 }, (_, i) => mkPost(`filler-${i}`, `Filler${i}`, { timestamp: now - i * 60 }))
const meta = () => ({
  startBankroll: 10000,
  totalTournaments: 3565,
  brHistory: [
    { brAfter: 10500, date: '05.04', timestamp: 1712300000, sessionResult: 500, text: 'Day #3' },
    { brAfter: 11000, date: '07.04', timestamp: 1712500000, sessionResult: 500, text: 'Day #5' },
  ],
  lastUpdated: '2026-04-19T02:00:00.000Z',
})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const barFor = ts => [...document.querySelectorAll('[role="button"][aria-label]')]
  .find(bar => bar.getAttribute('aria-label').startsWith(`${warsawDayKey(ts)}:`))

// jsdom never scrolls: scrollY is whatever this fake browser says
const fakeScroll = (start, onRequest) => {
  const saved = Object.getOwnPropertyDescriptor(window, 'scrollY')
  const state = { y: start }
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => state.y })
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (opts) { onRequest(opts, state) })
  const restore = () => { if (saved) Object.defineProperty(window, 'scrollY', saved); else delete window.scrollY }
  return { state, spy, restore }
}
const instants = spy => spy.mock.calls.filter(([o]) => o?.behavior === 'instant')

// the settle registers ONE function for all four reader inputs; find it, so that its removal can be checked
const watchListeners = () => {
  const adds = []
  const removes = []
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => { adds.push([type, fn, opts]); return add(type, fn, opts) })
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, fn, opts) => { removes.push([type, fn]); return remove(type, fn, opts) })
  const settleFn = () => {
    const candidates = adds.filter(([type, , opts]) => CANCEL_EVENTS.includes(type) && opts?.passive === true).map(([, fn]) => fn)
    return [...new Set(candidates)].find(fn => CANCEL_EVENTS.every(type => adds.some(([t, f]) => t === type && f === fn)))
  }
  const removedEvents = fn => CANCEL_EVENTS.filter(type => removes.some(([t, f]) => t === type && f === fn))
  return { settleFn, removedEvents }
}

const mount = async () => {
  fetchPublicData.mockResolvedValue({ meta: meta(), posts: [...fillers, mkPost('romeo-old', 'Romeopro', { timestamp: oldDay, likes: 50, text: 'Old Romeo report' })] })
  render(<App />)
  await screen.findByTestId('pace-widget')
}
const jumpFromDayRow = async () => {
  await mount()
  fireEvent.click(barFor(oldDay))
  const row = await waitFor(() => {
    const el = document.querySelector('.chart-wrap .day-events .day-event-clickable')
    expect(el).toBeTruthy()
    return el
  })
  fireEvent.click(row)
  await waitFor(() => expect(document.getElementById('post-romeo-old')).toHaveClass('post-highlight'))
}

describe('settling after an in-page jump', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it.each(CANCEL_EVENTS)('lets go as soon as the reader gives "%s" input', async type => {
    const { spy, restore } = fakeScroll(5000, (opts, st) => { if (opts.behavior === 'smooth') st.y -= 40 }) // cut short: a snap is due
    try {
      await jumpFromDayRow()
      window.dispatchEvent(new Event(type))
      await pause(700)
      expect(instants(spy)).toHaveLength(0)
    } finally { restore() }
  })

  it('does not snap to a target that left the DOM, and ends', async () => {
    const watch = watchListeners()
    const { spy, restore } = fakeScroll(5000, (opts, st) => { if (opts.behavior === 'smooth') st.y -= 40 })
    try {
      await jumpFromDayRow()
      // the post is gone from the document (instance-level override: React keeps owning the real node)
      Object.defineProperty(document.getElementById('post-romeo-old'), 'isConnected', { configurable: true, get: () => false })
      await pause(700)
      expect(instants(spy)).toHaveLength(0)
      expect(watch.removedEvents(watch.settleFn())).toEqual(CANCEL_EVENTS) // and it cleaned up after itself
    } finally { restore() }
  })

  it('stops after 4 snaps even when every snap moves the page again', async () => {
    const { spy, restore } = fakeScroll(100000, (opts, st) => {
      if (opts.behavior === 'smooth') st.y -= 40
      else st.y -= 1000 // the page keeps changing under the post: never "in place"
    })
    try {
      await jumpFromDayRow()
      // The settle is a real requestAnimationFrame loop (6 quiet frames per snap) clocked by performance.now(): the
      // 4 snaps take about 2.2 s here. Real timers are kept (faking rAF and performance.now together would change what
      // is under test); the wait is widened instead, to the 5 s the settle itself allows (SETTLE_MAX_MS), and the
      // test gets its own 15 s limit so a loaded machine cannot cut it off first (ASM-T7).
      await waitFor(() => expect(instants(spy).length).toBeGreaterThanOrEqual(4), { timeout: 8000 })
      await pause(1500)
      expect(instants(spy)).toHaveLength(4)
    } finally { restore() }
  }, 15000)

  it('gives up after 5 s when the page never holds still', async () => {
    const watch = watchListeners()
    const { spy, restore } = fakeScroll(5000, (opts, st) => { if (opts.behavior === 'smooth') st.y -= 40 })
    let height = 1000
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => ++height }) // grows on every read
    const realNow = performance.now.bind(performance)
    let skew = 0
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skew)
    try {
      await jumpFromDayRow()
      await pause(400)
      expect(instants(spy)).toHaveLength(0) // never quiet, so never a snap
      const settleFn = watch.settleFn()
      expect(settleFn).toBeTypeOf('function')
      expect(watch.removedEvents(settleFn)).toEqual([]) // still waiting
      skew = 6000 // 6 s pass
      await waitFor(() => expect(watch.removedEvents(settleFn)).toEqual(CANCEL_EVENTS), { timeout: 1000 })
      expect(instants(spy)).toHaveLength(0)
    } finally {
      delete document.documentElement.scrollHeight
      restore()
    }
  })

  it('removes its window listeners again when it is done', async () => {
    const watch = watchListeners()
    const { spy, restore } = fakeScroll(5000, (opts, st) => { if (opts.behavior === 'smooth') st.y = 2000 }) // landed
    try {
      await jumpFromDayRow()
      await waitFor(() => expect(instants(spy)).toHaveLength(1), { timeout: 3000 })
      const settleFn = watch.settleFn()
      expect(settleFn).toBeTypeOf('function')
      await waitFor(() => expect(watch.removedEvents(settleFn)).toEqual(CANCEL_EVENTS))
    } finally { restore() }
  })
})
