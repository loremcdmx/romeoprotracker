import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(),
}))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Review wave 2026-11-16, cluster K5b (page chrome and feed): feed counters,
// phone menu, lightbox focus, focus scroll-margin only for keyboard users,
// opaque pinned block / tooltips, wrapping hero line.

const NOW = Math.floor(Date.now() / 1000)
const CSS = readFileSync(resolve(__dirname, 'app.css'), 'utf8')
const META = { startBankroll: 10000, totalTournaments: 100, brHistory: [], lastUpdated: '2026-04-19T02:00:00.000Z' }

function makePosts(n, over = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1000 + i), author: `User${i}`, text: `post number ${i}`, likes: 10,
    timestamp: NOW - 3600 - i * 600, date: 'x', avatar: null, rating: 1000, msgCount: 50,
    regData: '2021', brAfter: null, images: [], url: `https://forum.gipsyteam.ru/p${i}`, ...over(i),
  }))
}

async function renderApp(posts, lang = 'ru') {
  localStorage.clear()
  localStorage.setItem('rpt_lang', lang)
  fetchPublicData.mockResolvedValue({ posts, meta: META, source: 'test', checkedAt: Date.now() })
  const utils = render(<App />)
  await waitFor(() => { if (!document.querySelector('.post-card')) throw new Error('no cards yet') })
  return utils
}

beforeEach(() => {
  fetchPublicData.mockReset()
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  document.documentElement.classList.remove('ptr-press')
})

const rule = (selector) => {
  const i = CSS.indexOf(selector + '{')
  if (i < 0) throw new Error(`no rule ${selector}`)
  return CSS.slice(i, CSS.indexOf('}', i))
}

describe('NUM-P6: feed counters group thousands', () => {
  it('ru: count, range and total', async () => {
    await renderApp(makePosts(5159))
    expect(document.querySelector('.filter-active-count').textContent).toBe('5 159 постов')
    const range = [...document.querySelectorAll('.pagination .page-info')].map((n) => n.textContent).find((t) => t.includes('–'))
    expect(range).toBe('1–20 из 5 159')
  })
  it('en: count and range', async () => {
    const { unmount } = await renderApp(makePosts(5159, () => ({ author: 'Romeopro' })), 'en') // the English feed shows Romeo posts only
    expect(document.querySelector('.filter-active-count').textContent).toBe('5 159 posts')
    const range = [...document.querySelectorAll('.pagination .page-info')].map((n) => n.textContent).find((t) => t.includes('–'))
    expect(range).toBe('1–20 / 5 159')
    unmount()
  })
  it('ru plural follows the number (21 пост, 1 021 пост, 2 003 поста)', async () => {
    for (const [n, text] of [[21, '21 пост'], [1021, '1 021 пост'], [2003, '2 003 поста']]) {
      const { unmount } = await renderApp(makePosts(n))
      expect(document.querySelector('.filter-active-count').textContent).toBe(text)
      unmount()
    }
  })
})

describe('UI-P5: phone menu closes', () => {
  const open = () => {
    const menu = document.querySelector('.mobile-menu')
    menu.setAttribute('open', '')
    menu.querySelector('summary').focus()
    return menu
  }
  it('on Escape, returning focus to the summary', async () => {
    await renderApp(makePosts(3))
    const menu = open()
    menu.querySelector('.mobile-menu-nav button').focus()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(menu.querySelector('summary'))
  })
  it('on a press outside, not on a press inside', async () => {
    await renderApp(makePosts(3))
    const menu = open()
    fireEvent.pointerDown(menu.querySelector('.mobile-menu-panel'))
    expect(menu.open).toBe(true)
    fireEvent.pointerDown(document.querySelector('.post-card'))
    expect(menu.open).toBe(false)
  })
  it('when focus leaves to nowhere (relatedTarget null: browser chrome, another window)', async () => {
    await renderApp(makePosts(3))
    const menu = open()
    menu.querySelector('.mobile-menu-nav button').focus()
    document.activeElement.blur()
    fireEvent.focusOut(menu.querySelector('summary'), { relatedTarget: null })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(menu.open).toBe(false)
    const menu2 = open()
    fireEvent.blur(window)
    expect(menu2.open).toBe(false)
  })
  it('when focus leaves it', async () => {
    await renderApp(makePosts(3))
    const menu = open()
    const outside = document.querySelector('.theme-toggle')
    fireEvent.blur(menu.querySelector('summary'), { relatedTarget: menu.querySelector('.mobile-menu-nav button') })
    expect(menu.open).toBe(true)
    fireEvent.focusOut(menu.querySelector('summary'), { relatedTarget: outside })
    expect(menu.open).toBe(false)
  })
})

describe('UI-P3: lightbox focus', () => {
  it('moves to the close button, stays inside, returns to the opener on every close path', async () => {
    await renderApp(makePosts(3, () => ({ images: ['https://example.test/a.png'] })))
    for (const closer of ['escape', 'button', 'backdrop']) {
      const thumb = document.querySelector('.pc-img')
      thumb.focus()
      fireEvent.click(thumb)
      const close = document.querySelector('.lightbox-close')
      expect(document.activeElement).toBe(close)
      // Tab cannot leave the dialog: it is cancelled on the only control, and focus
      // that lands outside is pulled back
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      close.dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(true)
      document.querySelector('.theme-toggle').focus()
      expect(document.activeElement).toBe(close)
      if (closer === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
      else if (closer === 'button') fireEvent.click(close)
      else fireEvent.click(document.querySelector('.lightbox'))
      await waitFor(() => expect(document.querySelector('.lightbox')).toBeNull())
      expect(document.activeElement, closer).toBe(document.querySelector('.pc-img'))
    }
  })
})

describe('DIFF-1: focus margin is the default, dropped only around a pointer press', () => {
  const root = () => document.documentElement
  it('a press sets .ptr-press, it ends 400ms after pointerup, and a keydown ends it at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<App />)
      expect(root().classList.contains('ptr-press')).toBe(false)
      fireEvent.pointerDown(document.body)
      expect(root().classList.contains('ptr-press')).toBe(true)
      fireEvent.pointerUp(document.body)
      vi.advanceTimersByTime(300)
      expect(root().classList.contains('ptr-press')).toBe(true)
      vi.advanceTimersByTime(150)
      expect(root().classList.contains('ptr-press')).toBe(false)
      fireEvent.pointerDown(document.body)
      fireEvent.keyDown(document.body, { key: 'a' })
      expect(root().classList.contains('ptr-press')).toBe(false)
    } finally { vi.useRealTimers() }
  })
  it('the class never sticks: pointercancel, window blur, hidden tab and the 8s cap clear it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<App />)
      fireEvent.pointerDown(document.body); fireEvent(document.body, new Event('pointercancel', { bubbles: true }))
      vi.advanceTimersByTime(450)
      expect(root().classList.contains('ptr-press')).toBe(false)
      fireEvent.pointerDown(document.body); fireEvent.blur(window)
      expect(root().classList.contains('ptr-press')).toBe(false)
      fireEvent.pointerDown(document.body)
      vi.advanceTimersByTime(8100)
      expect(root().classList.contains('ptr-press')).toBe(false)
    } finally { vi.useRealTimers() }
  })
  it('the default focus margin has no class condition; the suppression is a later zero-specificity rule', () => {
    const def = ':where(a,button,input,select,textarea,summary,[tabindex]){scroll-margin-top:calc(var(--sticky-stack-h) + 12px)}'
    const sup = ':where(.ptr-press) :where(a,button,input,select,textarea,summary,[tabindex]){scroll-margin-top:0}'
    expect(CSS).toContain('\n' + def)
    expect(CSS.indexOf(sup)).toBeGreaterThan(CSS.indexOf('\n' + def))
    expect(CSS).not.toMatch(/kbd-nav/)
  })
  const focusWithRect = async (rectTop) => {
    await renderApp(makePosts(3))
    const input = document.getElementById('filter-min-likes')
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const into = vi.spyOn(input, 'scrollIntoView').mockImplementation(() => {})
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: rectTop, bottom: rectTop + 30, left: 0, right: 10, width: 10, height: 30 })
    const topbar = document.querySelector('.topbar')
    vi.spyOn(topbar, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100, left: 0, right: 10, width: 10, height: 100 })
    const orig = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...a) => {
      const cs = orig(el, ...a)
      return el === topbar ? new Proxy(cs, { get: (t, k) => (k === 'position' ? 'sticky' : Reflect.get(t, k)) }) : cs
    })
    input.focus()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return { scrollBy, into }
  }
  it('a mouse click on an input already visible below the stack does not scroll the page', async () => {
    for (const top of [100, 103, 106, 109, 111, 112, 400]) {
      const { scrollBy, into } = await focusWithRect(top + 12 > 100 ? Math.max(top, 100) : top)
      expect(scrollBy, `top ${top}`).not.toHaveBeenCalled()
      expect(into, `top ${top}`).not.toHaveBeenCalled()
      vi.restoreAllMocks()
      window.HTMLElement.prototype.scrollIntoView = vi.fn()
    }
  })
  it('an input partly under the stack is still brought 12px below it', async () => {
    const { scrollBy } = await focusWithRect(80)
    expect(scrollBy).toHaveBeenCalledWith({ top: 80 - 100 - 12, behavior: 'instant' })
  })
})

describe('UI-6 / UI-P2 / UI-7: opaque surfaces and a wrapping hero line', () => {
  const alpha = (css) => css.match(/rgba\([^)]*\)/g) || []
  it('the pinned progress block is opaque in both themes', () => {
    expect(rule('.marathon-progress')).not.toMatch(/background:[^;]*(rgba|linear-gradient)/)
    expect(rule('.marathon-progress')).toMatch(/background:#111/)
    expect(CSS).toMatch(/\.light \.marathon-progress\{background:rgb\(235,232,226\);/)
  })
  it('the chart tooltip is opaque in both themes', () => {
    expect(rule('.chart-tooltip')).toMatch(/background:rgb\(18,18,18\);/)
    expect(CSS).toMatch(/\.light \.chart-tooltip\{background:rgb\(\d+,\d+,\d+\);/)
    expect(alpha(CSS.match(/\.light \.chart-tooltip\{background:[^;]*;/)[0])).toHaveLength(0)
  })
  it('the phone hero line wraps instead of cutting the last-post date', () => {
    const phone = CSS.slice(CSS.indexOf('.hero-desc{font-size:12px'), CSS.indexOf('.hero-desc{font-size:12px') + 260)
    expect(phone).not.toMatch(/nowrap|ellipsis/)
    expect(phone).toMatch(/\.hero-lastpost\{display:block\}/)
  })
})
