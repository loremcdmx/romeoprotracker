import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeFixedPopupLayout,
  computeSvgTooltipLayout,
  computeTouchSheetLayout,
  findHoverListIndexAtPoint,
  getZoomedViewportMetrics,
  normalizeViewportRect,
  watchPopupContentLoad,
} from './floating.js'

describe('floating helpers', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 720, writable: true })
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('reads zoomed viewport dimensions from the root element', () => {
    document.getElementById('root').style.zoom = '1.5'

    expect(getZoomedViewportMetrics()).toEqual({
      zoom: 1.5,
      vw: 1280 / 1.5,
      vh: 720 / 1.5,
    })
  })

  it('normalizes DOM rect coordinates back to the unzoomed viewport', () => {
    expect(normalizeViewportRect({
      left: 300,
      right: 600,
      top: 120,
      bottom: 420,
      width: 300,
      height: 300,
    }, 1.5)).toEqual({
      left: 200,
      right: 400,
      top: 80,
      bottom: 280,
      width: 200,
      height: 200,
    })
  })

  it('clamps the popup inside the viewport on the right edge', () => {
    const layout = computeFixedPopupLayout({
      anchorRect: { left: 1180, right: 1220, top: 180, bottom: 220, width: 40, height: 40 },
      panelRect: { height: 260 },
      preferredWidth: 340,
      minWidth: 220,
    })

    expect(layout.left + layout.width).toBeLessThanOrEqual(1272)
    expect(layout.top).toBeGreaterThanOrEqual(8)
  })

  it('uses smart vertical placement for lower anchors without pinning to the top', () => {
    const layout = computeFixedPopupLayout({
      anchorRect: { left: 120, right: 320, top: 560, bottom: 600, width: 200, height: 40 },
      panelRect: { height: 240 },
      preferredWidth: 340,
      minWidth: 220,
      vertical: 'smart',
    })

    expect(layout.top).toBeGreaterThan(8)
    expect(layout.top + 240).toBeLessThanOrEqual(712)
  })

  it('honors an explicit left-side placement request', () => {
    const layout = computeFixedPopupLayout({
      anchorRect: { left: 900, right: 980, top: 180, bottom: 240, width: 80, height: 60 },
      panelRect: { height: 180 },
      preferredWidth: 260,
      side: 'left',
    })

    expect(layout.left + layout.width).toBeLessThanOrEqual(892)
    expect(layout.transformOrigin.startsWith('right')).toBe(true)
  })

  it('honors an explicit right-side placement request', () => {
    const layout = computeFixedPopupLayout({
      anchorRect: { left: 120, right: 200, top: 180, bottom: 240, width: 80, height: 60 },
      panelRect: { height: 180 },
      preferredWidth: 260,
      side: 'right',
    })

    expect(layout.left).toBeGreaterThanOrEqual(208)
    expect(layout.transformOrigin.startsWith('left')).toBe(true)
  })

  it('shrinks width and clamps top in a tiny viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 260, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 190, writable: true })

    const layout = computeFixedPopupLayout({
      anchorRect: { left: 140, right: 180, top: 140, bottom: 180, width: 40, height: 40 },
      panelRect: { height: 320 },
      preferredWidth: 340,
      minWidth: 220,
      vertical: 'top',
    })

    expect(layout.width).toBeLessThanOrEqual(244)
    expect(layout.top).toBeGreaterThanOrEqual(8)
    expect(layout.top).toBeLessThanOrEqual(42)
  })

  it('returns null when no anchor rect is available', () => {
    expect(computeFixedPopupLayout({ anchorRect: null })).toBeNull()
  })

  it('finds a hovered item directly under the pointer', () => {
    const index = findHoverListIndexAtPoint({
      items: [
        { index: 0, rect: { left: 100, right: 200, top: 100, bottom: 140 } },
        { index: 1, rect: { left: 100, right: 200, top: 140, bottom: 180 } },
      ],
      point: { x: 150, y: 160 },
    })

    expect(index).toBe(1)
  })

  it('keeps matching rows through the popup corridor on the left side', () => {
    const index = findHoverListIndexAtPoint({
      items: [
        { index: 0, rect: { left: 980, right: 1280, top: 100, bottom: 148 } },
        { index: 1, rect: { left: 980, right: 1280, top: 148, bottom: 196 } },
      ],
      popupRect: { left: 620, right: 960, top: 80, bottom: 260 },
      point: { x: 800, y: 170 },
      edge: 6,
    })

    expect(index).toBe(1)
  })

  it('returns null when the pointer is outside both rows and popup corridor', () => {
    const index = findHoverListIndexAtPoint({
      items: [
        { index: 0, rect: { left: 980, right: 1280, top: 100, bottom: 148 } },
      ],
      popupRect: { left: 620, right: 960, top: 80, bottom: 260 },
      point: { x: 580, y: 220 },
      edge: 6,
    })

    expect(index).toBeNull()
  })
})

describe('computeTouchSheetLayout', () => {
  const base = { viewportHeight: 812, panelHeight: 297 }

  it('sits above the finger when there is room', () => {
    const layout = computeTouchSheetLayout({ ...base, touchY: 500 })
    expect(layout.top + 297).toBe(500 - 16)
  })

  it('keeps the legacy 90px reserve at the bottom of the screen', () => {
    const layout = computeTouchSheetLayout({ ...base, touchY: 790 })
    expect(layout.top + 297).toBe(812 - 90)
  })

  it('flips below the finger instead of leaving the top of the viewport', () => {
    const layout = computeTouchSheetLayout({ ...base, touchY: 190 })
    expect(layout.top).toBe(190 + 16)
    expect(layout.top + 297).toBeLessThanOrEqual(812 - 8)
  })

  it('takes the roomier side and caps the height when neither side holds the sheet', () => {
    const above = computeTouchSheetLayout({ touchY: 250, panelHeight: 297, viewportHeight: 375 })
    expect(above.top).toBe(8)
    expect(above.maxHeight).toBe(250 - 16 - 8)
    const below = computeTouchSheetLayout({ touchY: 90, panelHeight: 400, viewportHeight: 375 })
    expect(below.top).toBe(90 + 16)
    expect(below.maxHeight).toBe(375 - 8 - 106)
  })

  it('never covers the touch point', () => {
    for (const viewportHeight of [320, 375, 568, 812]) {
      for (let touchY = 0; touchY <= viewportHeight; touchY += 13) {
        const { top, maxHeight } = computeTouchSheetLayout({ touchY, panelHeight: 297, viewportHeight })
        const bottom = top + Math.min(297, maxHeight)
        expect(top).toBeGreaterThanOrEqual(8)
        expect(bottom).toBeLessThanOrEqual(viewportHeight - 8)
        expect(touchY > top && touchY < bottom).toBe(false)
      }
    }
  })
})

describe('computeSvgTooltipLayout', () => {
  const viewBox = { width: 340, height: 156 }

  it('maps viewBox units through the rendered size, letterbox included', () => {
    // svg box 340x218: scale 1, centred vertically (31px above and below);
    // the tooltip (100x40) sits centred, 10px above the anchor
    const layout = computeSvgTooltipLayout({
      svgRect: { left: 50, top: 400, width: 340, height: 218 }, viewBox, point: { x: 170, y: 80 }, tipWidth: 100, tipHeight: 40,
    })
    expect(layout).toEqual({ left: 120, top: 31 + 80 - 10 - 40, placement: 'above' })
    // desktop: 640x156 drawn into a 1000px wide column -> 1.5625x
    const wide = computeSvgTooltipLayout({
      svgRect: { left: 0, top: 0, width: 1000, height: 244 }, viewBox: { width: 640, height: 156 },
      point: { x: 320, y: 80 }, tipWidth: 100, tipHeight: 40,
    })
    expect(wide.left).toBeCloseTo(500 - 50, 5)
    expect(wide.top).toBeCloseTo(0.125 + 80 * 1.5625 - 10 - 40, 5)
  })

  it('clamps the tooltip by its pixel width inside the box', () => {
    const svgRect = { left: 0, top: 0, width: 340, height: 156 }
    const at = x => computeSvgTooltipLayout({ svgRect, viewBox, point: { x, y: 120 }, tipWidth: 150, tipHeight: 40 })
    expect(at(6).left).toBe(4)
    expect(at(338).left).toBe(340 - 150 - 4)
    // a tooltip wider than the box cannot be satisfied; it stays at the left stop
    expect(computeSvgTooltipLayout({ svgRect, viewBox, point: { x: 170, y: 120 }, tipWidth: 400, tipHeight: 40 }).left).toBe(4)
  })

  it('divides the #root zoom out of the measured rects', () => {
    // at zoom 0.85 a 340-unit svg paints 289px wide; CSS px stay 340
    const layout = computeSvgTooltipLayout({
      svgRect: { left: 0, top: 0, width: 289, height: 132.6 }, viewBox, point: { x: 170, y: 100 },
      tipWidth: 100, tipHeight: 40, zoom: 0.85,
    })
    expect(layout.left).toBeCloseTo(170 - 50, 5)
    expect(layout.top).toBeCloseTo(100 - 10 - 40, 5)
    // bounds are measured rects too: a card 50 CSS px (42.5 painted) above the svg
    const tall = computeSvgTooltipLayout({
      svgRect: { left: 0, top: 100, width: 289, height: 132.6 }, viewBox, point: { x: 170, y: 40 },
      tipWidth: 100, tipHeight: 60, boundsRect: { left: 0, top: 57.5, width: 289, height: 300 }, zoom: 0.85,
    })
    // 40 - 10 - 60 = -30 is under the card's top limit of -46? no, it fits
    expect(tall.placement).toBe('above')
    const tight = computeSvgTooltipLayout({
      svgRect: { left: 0, top: 100, width: 289, height: 132.6 }, viewBox, point: { x: 170, y: 16 },
      tipWidth: 100, tipHeight: 60, boundsRect: { left: 0, top: 57.5, width: 289, height: 300 }, zoom: 0.85,
    })
    expect(tight.placement).not.toBe('above')
  })

  it('returns null without a rendered box (jsdom)', () => {
    expect(computeSvgTooltipLayout({ svgRect: { width: 0, height: 0 }, viewBox, point: { x: 1, y: 1 } })).toBeNull()
  })

  describe('when there is no room above the anchor inside the clipping card', () => {
    // 640-unit desktop chart at scale 1.1375 (728x177.5); the card starts 50px above it
    const wide = { width: 640, height: 156 }
    const args = {
      svgRect: { left: 20, top: 500, width: 728, height: 177.5 }, viewBox: wide,
      tipWidth: 148, tipHeight: 65, boundsRect: { left: 0, top: 450, width: 768, height: 260 },
    }
    const tallest = x => ({ x, y: 16, halfWidth: 1.5 }) // plot top: 18.2px under the svg top

    it('stays above when the tooltip fits under the card edge', () => {
      const layout = computeSvgTooltipLayout({ ...args, point: { x: 300, y: 60, halfWidth: 1.5 } })
      expect(layout.placement).toBe('above')
      expect(layout.top).toBeCloseTo(60 * 1.1375 - 10 - 65, 1)
    })

    it('puts it right of the bar (never above the card top)', () => {
      const layout = computeSvgTooltipLayout({ ...args, point: tallest(100) })
      expect(layout.placement).toBe('right')
      // clear of the bar and its gap, inside the card vertically
      expect(layout.left).toBeGreaterThan(100 * 1.1375 + 1.5 * 1.1375)
      expect(layout.top).toBeGreaterThanOrEqual(-50 + 4)
      expect(layout.top + 65).toBeLessThanOrEqual(260 - 50 - 4)
    })

    it('puts it left of the bar when the right side is too narrow', () => {
      const layout = computeSvgTooltipLayout({ ...args, point: tallest(600) })
      expect(layout.placement).toBe('left')
      expect(layout.left + 148).toBeLessThan(600 * 1.1375 - 1.5 * 1.1375)
      expect(layout.left).toBeGreaterThanOrEqual(4)
      expect(layout.top).toBeGreaterThanOrEqual(-50 + 4)
    })

    it('pins it under the card edge when neither side has room', () => {
      const layout = computeSvgTooltipLayout({
        ...args, svgRect: { left: 20, top: 500, width: 340, height: 177.5 }, viewBox: { width: 340, height: 156 },
        tipWidth: 330, point: tallest(170),
      })
      expect(layout).toMatchObject({ top: -50 + 4, placement: 'inside' })
      expect(layout.left).toBeGreaterThanOrEqual(4)
      expect(layout.left + 330).toBeLessThanOrEqual(340 - 4)
    })

    it('ignores a card box it could not measure (jsdom, display:none)', () => {
      const layout = computeSvgTooltipLayout({ ...args, boundsRect: { left: 0, top: 0, width: 0, height: 0 }, point: tallest(100) })
      expect(layout.placement).toBe('above')
    })
  })
})

describe('watchPopupContentLoad', () => {
  it('fires for load and error events of descendants and detaches cleanly', () => {
    const popup = document.createElement('div')
    const img = document.createElement('img')
    popup.appendChild(img)
    const onChange = vi.fn()
    const stop = watchPopupContentLoad(popup, onChange)

    img.dispatchEvent(new Event('load'))
    img.dispatchEvent(new Event('error'))
    expect(onChange).toHaveBeenCalledTimes(2)

    stop()
    img.dispatchEvent(new Event('load'))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(() => watchPopupContentLoad(null, onChange)()).not.toThrow()
  })
})
