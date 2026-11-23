import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  dedupBrHistory,
  fk,
  fkAbs,
  fmtBR,
  fmtExact,
  fmtExactSigned,
  fmtInt,
  fmtNum,
  safeHttpUrl,
  spansMultipleYears,
  timeAgo,
  warsawDayKey,
  warsawParts,
} from './utils.js'
import { sanitizeBrHistory } from './historyGuards.js'
import { translate } from './i18n.js'
import { expandPosts } from './storage.js'
import { buildPaceSegments, SidebarTopList } from './App.jsx'
import { textSignature, translatePost, translateText } from '../scripts/lib/translation.mjs'

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

describe('bughunt & optimization regression tests', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('non-finite & hostile value guards', () => {
    it('warsawParts, warsawDayKey, and spansMultipleYears never throw RangeError', () => {
      for (const bad of [Infinity, -Infinity, NaN, 1e20, -1e20, 0, null, undefined]) {
        expect(() => warsawParts(bad)).not.toThrow()
        expect(warsawParts(bad)).toBeNull()
        expect(() => warsawDayKey(bad)).not.toThrow()
        expect(warsawDayKey(bad)).toBe('')
      }
      expect(() => spansMultipleYears([Infinity, 1e20, -Infinity])).not.toThrow()
      expect(spansMultipleYears([Infinity, 1e20])).toBe(false)
    })

    it('money and time formatters return fallback on non-finite inputs', () => {
      for (const bad of [Infinity, -Infinity, NaN]) {
        expect(fmtBR(bad)).toBe('—')
        expect(fmtNum(bad)).toBe('—')
        expect(fmtInt(bad)).toBe('—')
        expect(fmtExact(bad)).toBe('—')
        expect(fmtExactSigned(bad)).toBe('—')
        expect(fk(bad)).toBe('—')
        expect(fkAbs(bad)).toBe('—')
        expect(timeAgo(bad)).toBeNull()
      }
    })

    it('sanitizeBrHistory drops non-finite timestamp values', () => {
      const [row] = sanitizeBrHistory([{ id: '1', brAfter: 12000, timestamp: Infinity }])
      expect(row.brAfter).toBe(12000)
      expect(row.timestamp).toBeUndefined()
    })

    it('dedupBrHistory preserves brAfter and totalTournaments if a duplicate omits them', () => {
      const merged = dedupBrHistory([
        { id: '1', timestamp: 100, brBefore: 10000, brAfter: 12500, totalTournaments: 500, tournaments: 50 },
        { id: '2', timestamp: 120, brBefore: 10000, brAfter: null, tournaments: 60 },
      ])
      expect(merged).toHaveLength(1)
      expect(merged[0].brAfter).toBe(12500)
      expect(merged[0].sessionResult).toBe(2500)
      expect(merged[0].totalTournaments).toBe(500)
    })

    it('safeHttpUrl allows only http/https URLs', () => {
      expect(safeHttpUrl('https://forum.gipsyteam.ru/test')).toBe('https://forum.gipsyteam.ru/test')
      expect(safeHttpUrl('http://example.com/a')).toBe('http://example.com/a')
      expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
      expect(safeHttpUrl('data:text/html,hi')).toBeNull()
      expect(safeHttpUrl('')).toBeNull()
      expect(safeHttpUrl(null)).toBeNull()
    })

    it('i18n translate ignores Object.prototype keys', () => {
      expect(translate('ru', 'toString')).toBe('toString')
      expect(translate('toString', 'tab_feed')).toBe(translate('ru', 'tab_feed'))
    })
  })

  describe('pace math fixes', () => {
    it('does not drop pre-cumulative MTT when idx > 0 has the first totalTournaments', () => {
      const sorted = [
        { id: '1', timestamp: 100, brBefore: 10000, brAfter: 11000, sessionResult: 1000, tournaments: 100 },
        { id: '2', timestamp: 200, brBefore: 11000, brAfter: 12000, sessionResult: 1000, tournaments: 100, totalTournaments: 200 },
      ]
      const segments = buildPaceSegments(sorted, () => true, 10000, 1000)
      expect(segments).toHaveLength(1)
      expect(segments[0].tournaments).toBe(200)
      expect(segments[0].profit).toBe(2000)
      expect(segments[0].rate).toBe(10)
    })

    it('preserves trailing zero-MTT profit after a full bin flush instead of dropping it', () => {
      const sorted = [
        { id: '1', timestamp: 100, brBefore: 10000, brAfter: 20000, sessionResult: 10000, totalTournaments: 1000 },
        // Lagging cumulative counter: 0 delta MTT, +2000 profit right after full 1000-MTT bin flush
        { id: '2', timestamp: 200, brBefore: 20000, brAfter: 22000, sessionResult: 2000, totalTournaments: 1000 },
      ]
      const segments = buildPaceSegments(sorted, () => true, 10000, 1000)
      expect(segments).toHaveLength(1)
      expect(segments[0].profit).toBe(12000)
      expect(segments[0].rate).toBe(12)
    })
  })

  describe('compact v2 expandPosts compatibility', () => {
    it('expands both compact v2 (interned authors/regData, omitted likes/date) and legacy v1', () => {
      const v2 = expandPosts({
        avatars: ['/img/imguser.png'],
        authors: ['Romeopro', 'Player'],
        regData: ['Регистрация: 01.01.2015'],
        posts: [
          { i: '10', a: 0, t: 1700000000, v: 0, g: 0, r: 0, x: 'Hello' },
          { i: '11', a: 1, t: 1700000100, l: 5, g: 0 },
        ],
      })
      expect(v2[0]).toMatchObject({
        id: '10',
        author: 'Romeopro',
        likes: 0,
        rating: 0,
        regData: 'Регистрация: 01.01.2015',
        avatar: 'https://forum.gipsyteam.com/img/imguser.png',
        date: '',
      })
      expect(v2[1]).toMatchObject({ id: '11', author: 'Player', likes: 5, regData: 'Регистрация: 01.01.2015' })

      const v1 = expandPosts({
        avatars: ['javascript:alert(1)'],
        posts: [{ i: '12', a: 'Legacy', t: 1700000200, l: 2, v: 0, g: 'Reg', d: '1 ноя' }],
      })
      expect(v1[0]).toMatchObject({ id: '12', author: 'Legacy', likes: 2, regData: 'Reg', avatar: null, date: '1 ноя' })
    })
  })

  describe('translation client resilience & deduplication', () => {
    it('catches network errors without throwing', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const fetchImpl = vi.fn().mockRejectedValue(new Error('socket hang up'))
      const res = await translateText('Достаточно длинный текст для проверки.', 'en', { apiKey: 'k', fetchImpl })
      expect(res).toBeNull()
    })

    it('skips calling API for a language already translated for the exact same text', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: 'Fresh Spanish' }] }),
      })
      const text = 'Достаточно длинный текст для проверки перевода.'
      const post = { text, translations: { ...textSignature(text), en: 'Existing EN', es: null } }
      const changed = await translatePost(post, { apiKey: 'k', fetchImpl })
      expect(changed).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(post.translations.en).toBe('Existing EN')
      expect(post.translations.es).toBe('Fresh Spanish')
    })
  })

  describe('SidebarTopList popup scroll, Escape, posts-change & URL safety', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true })
      Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true })
    })

    it('keeps popup open on internal scroll, closes on Escape, and blocks javascript: URLs', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const posts = [
        { id: '1', author: 'Alpha', text: 'Body', likes: 10, timestamp: 1712500000, images: [], url: 'javascript:alert(1)' },
      ]
      const { rerender } = render(<SidebarTopList posts={posts} setLightbox={vi.fn()} />)
      const item = screen.getByTestId('sidebar-top-item-0')
      fireEvent.click(item)
      expect(openSpy).not.toHaveBeenCalled()

      fireEvent.mouseEnter(item)
      const popup = await screen.findByTestId('sidebar-top-popup')
      // Scroll inside the popup's scrollable body must NOT dismiss the popup
      const scrollChild = popup.querySelector('div[style*="overflow-y"]') || popup
      fireEvent.scroll(scrollChild)
      expect(screen.getByTestId('sidebar-top-popup')).toBeInTheDocument()

      // Escape closes the popup
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => {
        expect(screen.queryByTestId('sidebar-top-popup')).toBeNull()
      })

      // Re-open and verify changing posts resets popup
      fireEvent.mouseEnter(item)
      await screen.findByTestId('sidebar-top-popup')
      rerender(<SidebarTopList posts={[{ ...posts[0], id: '2', author: 'Beta' }]} setLightbox={vi.fn()} />)
      await waitFor(() => {
        expect(screen.queryByTestId('sidebar-top-popup')).toBeNull()
      })
    })
  })

  describe('CSS fixes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

    it('does not animate background-position on .post-card.romeo-post', () => {
      expect(css).not.toContain('@keyframes gradBorder')
      expect(css).not.toContain('animation:gradBorder')
    })

    it('does not contain the broken .light html selector', () => {
      expect(css).not.toContain('.light html,body,#root')
    })

    it('places the 980px single-column .marathon-progress-inner rule after the base 2-column rule', () => {
      const baseIdx = css.indexOf('.marathon-progress-inner{\n  max-width:1480px')
      const mediaIdx = css.indexOf('.marathon-progress-inner{grid-template-columns:1fr}')
      expect(baseIdx).toBeGreaterThan(-1)
      expect(mediaIdx).toBeGreaterThan(baseIdx)
    })
  })
})
