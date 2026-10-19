import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App, { SidebarTopList } from './App.jsx'
import * as responsive from './hooks/useIsMobile.js'
import { fetchPublicData } from './storage.js'
import { replayMeta } from './realHistoryFixture.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// jsdom has no layout, so geometry is either read from SVG attributes (the
// chart is authored in user units) or fed in through a stubbed
// getBoundingClientRect that models what a browser would measure.
function stubRects(resolve) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const r = resolve(this) || { left: 0, top: 0, width: 0, height: 0 }
    return { x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, ...r }
  })
}

// The max-height a browser applies for an inline value, in CSS px (`vh` is
// zoom-scaled too, so calc(100vh - 16px) is innerHeight - 16 CSS px).
function cssMaxHeight(value) {
  if (!value || value === 'none') return Infinity
  if (value === 'calc(100vh - 16px)') return window.innerHeight - 16
  return parseFloat(value)
}

function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true })
}

describe('tooltip and label geometry', () => {
  let restore = []
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    setViewport(1280, 720)
  })
  afterEach(() => {
    restore.forEach(fn => fn())
    restore = []
    vi.restoreAllMocks()
    document.getElementById('root')?.remove()
  })

  const mockMobile = mobile => {
    vi.spyOn(responsive, 'useIsMobile').mockReturnValue(mobile)
  }
  const mockData = (meta, posts = []) => fetchPublicData.mockResolvedValue({ posts, meta, leaderboards: null })

  describe('MC-2: peak callout never covers a milestone plate', () => {
    const rectOf = el => ({ x: +el.getAttribute('x'), y: +el.getAttribute('y'), w: +el.getAttribute('width'), h: +el.getAttribute('height') })
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const record = [{ dt: 3600 * 8, result: 72000, tournaments: 300 }]

    // Replays of the real history: the first two are the days the old chooser
    // put the badge on top of the best-day plate, the others add a +$72k
    // session so the record day IS the new peak (all candidates then have the
    // plate under or next to them).
    it.each([
      ['desktop, history up to 2026-06-12', false, 83, []],
      ['phone, history up to 2026-06-17', true, 88, []],
      ['desktop, record day is the new peak', false, 189, record],
      ['phone, record day is the new peak', true, 189, record],
    ])('%s', async (_name, mobile, count, extra) => {
      mockMobile(mobile)
      mockData(replayMeta(count, extra))
      render(<App />)
      await screen.findByTestId('pace-widget')

      const badge = document.querySelector('.mc-peak-callout-bg')
      const plates = [...document.querySelectorAll('.mc-milestone-plate')]
      expect(badge).toBeTruthy()
      expect(plates.length).toBeGreaterThan(0)
      expect(document.querySelector('.mc-milestone-callout.best .mc-milestone-plate')).toBeTruthy()
      expect(plates.filter(plate => overlap(rectOf(badge), rectOf(plate)))).toHaveLength(0)
    })
  })

  describe('MC-1 / E2E-5: long-press tooltip stays inside the phone viewport', () => {
    const SHEET_HEIGHT = 297 // a merged six-session group, borders included

    // Where a browser would paint the fixed tooltip, from its inline style.
    function paintedBox(tooltip, touchY) {
      const px = value => (value && value.endsWith('px') ? parseFloat(value) : null)
      const innerHeight = window.innerHeight
      const maxHeight = px(tooltip.style.maxHeight) ?? innerHeight - 16
      const height = Math.min(SHEET_HEIGHT, maxHeight)
      const top = px(tooltip.style.top) ?? innerHeight - px(tooltip.style.bottom) - height
      return { top, bottom: top + height, covers: touchY > top && touchY < top + height }
    }

    async function longPress(clientY) {
      mockMobile(true)
      mockData(replayMeta(60))
      const sheetHeights = {
        scrollHeight: SHEET_HEIGHT - 2, offsetHeight: SHEET_HEIGHT, clientHeight: SHEET_HEIGHT - 2,
      }
      for (const [name, value] of Object.entries(sheetHeights)) {
        const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get() { return this.classList?.contains('mc-tooltip') ? value : 0 },
        })
        restore.push(() => (original
          ? Object.defineProperty(HTMLElement.prototype, name, original)
          : delete HTMLElement.prototype[name]))
      }
      render(<App />)
      await screen.findByTestId('pace-widget')
      const svg = document.querySelector('.marathon-chart .mc-svg')
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 438 })
      fireEvent.touchStart(svg, { touches: [{ clientX: 300, clientY }] })
      await waitFor(() => expect(document.querySelector('.mc-tooltip')).toBeTruthy(), { timeout: 3000 })
      return document.querySelector('.mc-tooltip')
    }

    it.each([
      ['near the top of the screen (flips below the finger)', 800, 90, false],
      ['in the middle (above the finger)', 800, 420, false],
      ['near the bottom (above the finger)', 800, 770, false],
      ['on a short landscape phone (takes the roomier side, scrolls inside)', 375, 190, true],
      ['on a short landscape phone, finger near the top', 375, 60, false],
    ])('%s', async (_name, viewportHeight, touchY, scrolls) => {
      setViewport(375, viewportHeight)
      const tooltip = await longPress(touchY)
      const box = paintedBox(tooltip, touchY)
      expect(box.top).toBeGreaterThanOrEqual(8)
      expect(box.bottom).toBeLessThanOrEqual(viewportHeight - 8)
      // the date / pill / BR header is the top of the sheet, never the clipped part
      expect(box.covers).toBe(false)
      // a sheet capped below its content height scrolls inside itself
      expect(tooltip.style.overflowY).toBe('auto')
      if (scrolls) expect(parseFloat(tooltip.style.maxHeight)).toBeLessThan(SHEET_HEIGHT)
    })
  })

  describe('E2E-4 / PH-2: session-MTT tooltip is placed in real pixels, inside its card', () => {
    function mttMeta(mtts = [500, 480, 460, 440, 420, 400, 200, 180, 160, 150, 140, 130]) {
      let total = 0
      const brHistory = mtts.map((mtt, i) => {
        total += mtt
        return {
          brAfter: 10000 + (i + 1) * 900, brPrev: 10000 + i * 900, date: `D${i + 1}`,
          timestamp: 1712300000 + i * 86400, sessionResult: i % 2 === 0 ? 900 : -400,
          totalTournaments: total, tournaments: mtt, text: `S${i}`,
        }
      })
      return { startBankroll: 10000, totalTournaments: total, brHistory, lastUpdated: '2026-04-19T02:00:00.000Z' }
    }

    // Box a browser paints for the tooltip, relative to the svg box. When the
    // component positions the corner it sets transform:none; otherwise the
    // stylesheet default of .smtt-tooltip applies (translate(-50%, -100% - 10px):
    // left/top are the centre of the bottom edge, 10px above the anchor).
    function paintedBox(tip, size) {
      const left = parseFloat(tip.style.left)
      const top = parseFloat(tip.style.top)
      const corner = tip.style.transform === 'none'
        ? { left, top }
        : { left: left - size.width / 2, top: top - size.height - 10 }
      return { ...corner, right: corner.left + size.width, bottom: corner.top + size.height }
    }
    const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

    // Renders the app with a stubbed layout (jsdom has none) and hovers a bar.
    // svg: the rendered chart box; card: the .pace-widget (overflow:hidden) box;
    // tip: the tooltip's own size. Everything the assertions return is in CSS px
    // relative to the svg box, i.e. what a browser would paint.
    async function hoverBar(index, { mobile, svg, card, tip: tipSize, viewBoxW, mtts }) {
      mockMobile(mobile)
      mockData(mttMeta(mtts))
      stubRects(el => {
        if (el.classList?.contains('smtt-chart')) return svg
        if (el.dataset?.testid === 'session-mtt-widget') return card
        if (el.classList?.contains('smtt-tooltip')) return { left: 0, top: 0, ...tipSize }
        return null
      })
      render(<App />)
      const widget = await screen.findByTestId('session-mtt-widget')
      const scale = svg.width / viewBoxW
      const bar = widget.querySelectorAll('.smtt-bar')[index]
      fireEvent.mouseMove(widget.querySelector('[data-testid="smtt-hover-capture"]'),
        { clientX: svg.left + (Number(bar.getAttribute('x')) + 1) * scale })
      const tip = widget.querySelector('.smtt-tooltip')
      const offsetY = (svg.height - 156 * scale) / 2
      const barBox = {
        left: Number(bar.getAttribute('x')) * scale,
        right: (Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))) * scale,
        top: offsetY + Number(bar.getAttribute('y')) * scale,
        bottom: offsetY + (Number(bar.getAttribute('y')) + Number(bar.getAttribute('height'))) * scale,
      }
      const cardBox = {
        left: card.left - svg.left, right: card.left - svg.left + card.width,
        top: card.top - svg.top, bottom: card.top - svg.top + card.height,
      }
      return { bar, tip, box: paintedBox(tip, tipSize), barBox, cardBox, svgBox: { width: svg.width, height: svg.height } }
    }

    // A 340-unit-wide phone svg that the CSS min-height letterboxes to 218px:
    // the drawing keeps scale 1 and is centred, 31px down; the card starts 60px above it.
    const PHONE = { mobile: true, viewBoxW: 340, svg: { left: 40, top: 500, width: 340, height: 218 },
      card: { left: 20, top: 440, width: 380, height: 300 }, tip: { width: 150, height: 50 } }
    const OFFSET_Y = (218 - 156) / 2

    it('sits 10px above the hovered bar, measured from the rendered svg', async () => {
      const { bar, tip, box } = await hoverBar(3, PHONE)
      expect(bar.classList.contains('hover')).toBe(true)
      expect(tip.dataset.placement).toBe('above')
      // bottom edge = bar top in CSS px (letterbox offset included) minus the 10px gap
      expect(box.bottom).toBeCloseTo(OFFSET_Y + Number(bar.getAttribute('y')) - 10, 1)
    })

    it('is clamped by its pixel width at the left edge of the card', async () => {
      const { box } = await hoverBar(0, PHONE)
      expect(box.left).toBeGreaterThanOrEqual(4 - 0.01)
      expect(box.left).toBeLessThan(40)
    })

    it('is clamped by its pixel width at the right edge of the card', async () => {
      const { box, svgBox } = await hoverBar(11, PHONE)
      expect(box.right).toBeLessThanOrEqual(svgBox.width - 4 + 0.01)
      expect(box.right).toBeGreaterThan(svgBox.width - 40)
    })

    // The tallest bar's top is the plot top, a few px under the card's top
    // edge; the tooltip cannot go above it and the card clips whatever sticks
    // out (overflow:hidden). 768px laptop/tablet column: a 728px svg drawn at
    // 640 units (scale 1.1375), a 65px tall tooltip, the card 50px above the svg.
    const TABLET = { mobile: false, viewBoxW: 640, svg: { left: 20, top: 500, width: 728, height: 177.5 },
      card: { left: 0, top: 450, width: 768, height: 260 }, tip: { width: 148, height: 65 } }

    it.each([
      ['the tallest bar at the left end goes right of the bar', 0, undefined, 'right'],
      ['the tallest bar at the right end goes left of the bar', 11, [130, 140, 150, 160, 180, 200, 400, 420, 440, 460, 480, 500], 'left'],
      ['a short bar keeps the tooltip above it', 5, undefined, 'above'],
    ])('768px: %s, inside the card and off the bar', async (_name, index, mtts, placement) => {
      const { tip, box, barBox, cardBox, svgBox } = await hoverBar(index, { ...TABLET, mtts })
      expect(tip.dataset.placement).toBe(placement)
      // not cut by the card's overflow:hidden (top and bottom) nor by the chart box sideways
      expect(box.top).toBeGreaterThanOrEqual(cardBox.top + 4 - 0.01)
      expect(box.bottom).toBeLessThanOrEqual(cardBox.bottom - 4 + 0.01)
      expect(box.left).toBeGreaterThanOrEqual(4 - 0.01)
      expect(box.right).toBeLessThanOrEqual(svgBox.width - 4 + 0.01)
      // never on top of the hovered bar
      expect(intersects(box, barBox)).toBe(false)
    })

    it('pins the tooltip under the card edge when the chart is too narrow for either side', async () => {
      // a 330px wide tooltip in a 340px chart: no side has room, nothing fits above
      const { tip, box, cardBox } = await hoverBar(0, { ...PHONE, card: { ...PHONE.card, top: 480, height: 260 }, tip: { width: 330, height: 80 } })
      expect(tip.dataset.placement).toBe('inside')
      expect(box.top).toBeGreaterThanOrEqual(cardBox.top + 4 - 0.01)
    })
  })

  describe('SH-4: the activity day tooltip is re-placed once its thumbnails load', () => {
    it('stays inside the viewport after the lazy image gives the popup its real height', async () => {
      const dayTs = Math.floor(Date.now() / 1000) - 2 * 86400
      mockData(replayMeta(12), [
        { id: 'r1', author: 'Romeopro', text: 'Session report', likes: 12, timestamp: dayTs, date: 'x',
          rating: 1, brAfter: 11000, sessionResult: 1000, images: ['https://example.com/shot.png'], url: 'https://e/1' },
      ])
      let imageLoaded = false
      stubRects(el => {
        if (el.classList?.contains('activity-bar')) return { left: 600, top: 330, width: 20, height: 60 }
        if (el.classList?.contains('chart-tooltip')) return { left: 0, top: 0, width: 380, height: imageLoaded ? 520 : 120 }
        return null
      })
      render(<App />)
      await screen.findByTestId('pace-widget')
      fireEvent.mouseEnter(document.querySelector('.activity-bar'))
      const tooltip = await waitFor(() => {
        const el = document.querySelector('.chart-tooltip')
        expect(el).toBeTruthy()
        expect(el.style.visibility).toBe('visible')
        return el
      }, { timeout: 3000 })
      const placed = () => ({ top: parseFloat(tooltip.style.top), height: imageLoaded ? 520 : 120 })
      // measured while the thumbnail was still 0px tall: fits trivially
      expect(placed().top + placed().height).toBeLessThanOrEqual(720 - 8)

      imageLoaded = true
      fireEvent.load(tooltip.querySelector('.day-event-thumb'))
      await waitFor(() => expect(placed().top + placed().height).toBeLessThanOrEqual(720 - 8))
      expect(placed().top).toBeGreaterThanOrEqual(8)
    })
  })

  describe('SH-5: the top-posts popup respects the #root zoom', () => {
    const ZOOM = 0.85
    const NATURAL = 900 // CSS px of a long post, thumbnail and footer link included

    it('leaves a tall popup inside the viewport when the page is zoomed out', async () => {
      setViewport(1280, 720)
      const rootEl = document.createElement('div')
      rootEl.id = 'root'
      rootEl.style.zoom = String(ZOOM)
      document.body.appendChild(rootEl)

      // What a browser paints: CSS px scale with the zoom
      const cssMax = cssMaxHeight
      const paintedHeight = el => ZOOM * Math.min(NATURAL, cssMax(el.style.maxHeight))
      stubRects(el => {
        if (el.dataset?.testid === 'sidebar-top-item-0') return { left: 1080, top: 300, width: 300, height: 48 }
        if (el.dataset?.testid === 'sidebar-top-popup') return { left: 0, top: 0, width: 340 * ZOOM, height: paintedHeight(el) }
        return null
      })

      render(
        <SidebarTopList setLightbox={vi.fn()} posts={[{
          author: 'Alpha', text: 'A very long post', likes: 25, timestamp: 1712500000, images: [],
          url: 'https://forum.gipsyteam.ru/test-alpha',
        }]}/>,
        { container: rootEl.appendChild(document.createElement('div')) },
      )
      fireEvent.mouseEnter(screen.getByTestId('sidebar-top-item-0'))
      const popup = await waitFor(() => {
        const el = screen.getByTestId('sidebar-top-popup')
        expect(el.style.visibility).toBe('visible')
        return el
      })
      const top = parseFloat(popup.style.top)
      const visualBottom = (top + Math.min(NATURAL, cssMax(popup.style.maxHeight))) * ZOOM
      expect(top).toBeGreaterThanOrEqual(8)
      expect(visualBottom).toBeLessThanOrEqual(720)
    })
  })

  describe('SH-5 (same root cause): the top-posts popup is re-placed when its post image loads', () => {
    it('stays inside the viewport once the image has given it its real height', async () => {
      setViewport(1440, 900)
      let imageLoaded = false
      stubRects(el => {
        if (el.dataset?.testid === 'sidebar-top-item-0') return { left: 1080, top: 700, width: 300, height: 48 }
        if (el.dataset?.testid === 'sidebar-top-popup') {
          return { left: 0, top: 0, width: 340, height: Math.min(imageLoaded ? 780 : 240, cssMaxHeight(el.style.maxHeight)) }
        }
        return null
      })
      render(<SidebarTopList setLightbox={vi.fn()} posts={[{
        author: 'Alpha', text: 'Post with a screenshot', likes: 25, timestamp: 1712500000,
        images: ['https://example.com/shot.png'], url: 'https://forum.gipsyteam.ru/test-alpha',
      }]}/>)
      fireEvent.mouseEnter(screen.getByTestId('sidebar-top-item-0'))
      const popup = await waitFor(() => {
        const el = screen.getByTestId('sidebar-top-popup')
        expect(el.style.visibility).toBe('visible')
        return el
      }, { timeout: 3000 })

      imageLoaded = true
      fireEvent.load(popup.querySelector('img'))
      await waitFor(() => {
        const top = parseFloat(popup.style.top)
        expect(top).toBeGreaterThanOrEqual(8)
        expect(top + 780).toBeLessThanOrEqual(900 - 8)
      })
    })
  })

  describe('PH-1: pace value labels do not collide with the x-axis labels', () => {
    const boxOf = (el, fontSize) => {
      const x = Number(el.getAttribute('x'))
      const y = Number(el.getAttribute('y'))
      const width = el.textContent.length * fontSize * .58
      const left = el.classList.contains('edge') ? x - width : x - width / 2
      return { left, right: left + width, top: y - fontSize * .8, bottom: y + fontSize * .25 }
    }
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

    it('moves the label of a losing point on the plot floor off the x label under it', async () => {
      // one losing week: a single point at -$30/MTT pinned to the bottom of the plot
      const now = Math.floor(Date.now() / 1000)
      const rows = [[400, -12000], [400, -14000], [612, -16600]]
      let br = 100000, total = 0
      const brHistory = rows.map(([mtt, result], i) => {
        br += result; total += mtt
        return { id: `loss-${i}`, brAfter: br, brPrev: br - result, date: `L${i}`, timestamp: now - (3 - i) * 3600,
          sessionResult: result, tournaments: mtt, totalTournaments: total, text: `Loss ${i}` }
      })
      mockData({ startBankroll: 10000, totalTournaments: total, brHistory, lastUpdated: new Date().toISOString() })
      render(<App />)
      const widget = await screen.findByTestId('pace-widget')

      const values = [...widget.querySelectorAll('.pace-chart-value')]
      const xLabels = [...widget.querySelectorAll('.pace-x-label')]
      expect(values.length).toBeGreaterThan(0)
      expect(xLabels.length).toBeGreaterThan(0)
      for (const value of values) {
        for (const label of xLabels) {
          expect(hit(boxOf(value, 10.5), boxOf(label, 10))).toBe(false)
        }
      }
    })
  })
})
