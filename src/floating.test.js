import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeFixedPopupLayout,
  findHoverListIndexAtPoint,
  getZoomedViewportMetrics,
  normalizeViewportRect,
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
