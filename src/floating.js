function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function isPointInsideRect(point, rect, edge = 0) {
  if (!point || !rect) return false
  return point.x >= rect.left - edge
    && point.x <= rect.right + edge
    && point.y >= rect.top - edge
    && point.y <= rect.bottom + edge
}

export function getZoomedViewportMetrics() {
  const zoom = parseFloat(document.getElementById('root')?.style.zoom) || 1
  return {
    zoom,
    vw: window.innerWidth / zoom,
    vh: window.innerHeight / zoom,
  }
}

export function normalizeViewportRect(rect, zoom = 1) {
  if (!rect) return null
  return {
    left: rect.left / zoom,
    right: rect.right / zoom,
    top: rect.top / zoom,
    bottom: rect.bottom / zoom,
    width: (rect.width ?? (rect.right - rect.left)) / zoom,
    height: (rect.height ?? (rect.bottom - rect.top)) / zoom,
  }
}

export function computeFixedPopupLayout({
  anchorRect,
  panelRect,
  preferredWidth = 340,
  minWidth = 220,
  gap = 8,
  edge = 8,
  side = 'auto',
  vertical = 'center',
}) {
  if (!anchorRect) return null

  const { zoom, vw, vh } = getZoomedViewportMetrics()
  const anchor = normalizeViewportRect(anchorRect, zoom)
  if (!anchor) return null

  const viewportMaxWidth = Math.max(180, vw - edge * 2)
  const safePreferredWidth = Math.min(preferredWidth, viewportMaxWidth)
  const safeMinWidth = Math.min(minWidth, viewportMaxWidth)
  const spaceRight = vw - anchor.right - gap - edge
  const spaceLeft = anchor.left - gap - edge

  const openLeft = side === 'left'
    ? true
    : side === 'right'
      ? false
      : spaceLeft > spaceRight

  const preferredSpace = openLeft ? spaceLeft : spaceRight
  const width = clamp(
    Math.min(safePreferredWidth, Math.max(safeMinWidth, preferredSpace)),
    Math.min(180, viewportMaxWidth),
    viewportMaxWidth,
  )

  let left = openLeft ? anchor.left - gap - width : anchor.right + gap
  left = clamp(left, edge, vw - width - edge)

  const maxHeight = Math.max(140, vh - edge * 2)
  const panelHeight = panelRect
    ? Math.min(panelRect.height / zoom, maxHeight)
    : maxHeight
  const anchorCenterY = anchor.top + anchor.height / 2

  let preferredTop = anchorCenterY - panelHeight / 2
  if (vertical === 'smart') {
    preferredTop = anchorCenterY <= vh / 2
      ? anchor.top - 6
      : anchor.bottom - panelHeight + 6
  } else if (vertical === 'top') {
    preferredTop = anchor.top - 4
  }

  const top = clamp(preferredTop, edge, vh - panelHeight - edge)

  return {
    left,
    top,
    width,
    maxHeight,
    transformOrigin: `${openLeft ? 'right' : 'left'} ${anchorCenterY <= vh / 2 ? 'top' : 'bottom'}`,
  }
}

// Vertical placement for a position:fixed sheet that opens next to a touch
// point (the marathon chart's long-press tooltip). It sits above the finger;
// when that would push its top out of the viewport it flips below the finger;
// when neither side holds the whole sheet (landscape phones, tall merged
// groups) it takes the roomier side and is capped with maxHeight, so the
// content scrolls inside it instead of being cut off by the viewport — and it
// never covers the touch point, which would swallow the touch's follow-up
// events. Inputs are layout pixels (window.innerHeight and clientY): the phone
// layout is never zoomed.
export function computeTouchSheetLayout({
  touchY,
  panelHeight,
  viewportHeight,
  edge = 8,
  gap = 16,
  bottomReserve = 90,
}) {
  const maxHeight = Math.max(120, viewportHeight - edge * 2)
  const height = Math.min(Math.max(panelHeight, 0), maxHeight)
  const aboveBottom = Math.min(viewportHeight - bottomReserve, touchY - gap)
  if (aboveBottom - height >= edge) return { top: aboveBottom - height, maxHeight }
  const belowTop = touchY + gap
  if (belowTop + height <= viewportHeight - edge) return { top: belowTop, maxHeight }
  const roomAbove = aboveBottom - edge
  const roomBelow = viewportHeight - edge - belowTop
  return roomBelow > roomAbove
    ? { top: belowTop, maxHeight: Math.max(roomBelow, 0) }
    : { top: edge, maxHeight: Math.max(roomAbove, 0) }
}

// Real-pixel anchor for a tooltip that floats over an SVG chart. A viewBox
// point is scaled by the rendered size of the svg (preserveAspectRatio "meet":
// the drawing is centred and, when the svg has a min-height, letterboxed), so
// viewBox units are NOT CSS pixels. Returns the TOP-LEFT corner of the tooltip
// in CSS pixels relative to the svg's own box — the padding-box origin of a
// wrapper whose first child is the display:block svg. Rects are the raw
// getBoundingClientRect values; the #root zoom is divided out like in
// computeFixedPopupLayout.
//
// Placement, all of it kept inside the svg box horizontally and inside
// boundsRect (the clipping card) vertically:
//   above  - centred over the anchor, `gap` above it (the normal case);
//   right / left - when the anchor sits too close to the top of the card for
//     the tooltip to fit above it (the tallest bars), beside the anchor, so it
//     still never covers the hovered bar;
//   inside - the chart is too narrow for either side: pinned just under the
//     card's top edge, which overlaps the top of the bar rather than being cut.
// point.halfWidth (viewBox units) is half the bar's width, for the side gap.
export function computeSvgTooltipLayout({
  svgRect,
  viewBox,
  point,
  tipWidth = 0,
  tipHeight = 0,
  boundsRect = null,
  edge = 4,
  gap = 10,
  zoom = 1,
}) {
  if (!svgRect || !viewBox || !(svgRect.width > 0) || !(svgRect.height > 0)) return null
  const scale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height)
  const offsetX = (svgRect.width - viewBox.width * scale) / 2
  const offsetY = (svgRect.height - viewBox.height * scale) / 2
  const boxWidth = svgRect.width / zoom
  const anchorX = (offsetX + point.x * scale) / zoom
  const anchorY = (offsetY + point.y * scale) / zoom
  const halfBar = ((point.halfWidth || 0) * scale) / zoom
  const hasBounds = !!boundsRect && boundsRect.width > 0 && boundsRect.height > 0
  const minTop = hasBounds ? (boundsRect.top - svgRect.top) / zoom + edge : -Infinity
  const maxBottom = hasBounds ? (boundsRect.top + boundsRect.height - svgRect.top) / zoom - edge : Infinity
  const maxLeft = boxWidth - tipWidth - edge
  const centred = clamp(anchorX - tipWidth / 2, edge, maxLeft)

  const above = anchorY - gap - tipHeight
  if (above >= minTop) return { left: centred, top: above, placement: 'above' }

  const sideTop = clamp(anchorY - tipHeight / 2, minTop, maxBottom - tipHeight)
  const sideGap = Math.max(gap - 2, 4)
  const right = anchorX + halfBar + sideGap
  if (right <= maxLeft) return { left: right, top: sideTop, placement: 'right' }
  const left = anchorX - halfBar - sideGap - tipWidth
  if (left >= edge) return { left, top: sideTop, placement: 'left' }
  return { left: centred, top: minTop, placement: 'inside' }
}

// Calls onChange when something inside a popup finishes loading (or fails),
// i.e. when lazy thumbnails get their real height after the popup was already
// measured and placed. load/error do not bubble, hence the capture listeners.
export function watchPopupContentLoad(el, onChange) {
  if (!el || typeof el.addEventListener !== 'function') return () => {}
  el.addEventListener('load', onChange, true)
  el.addEventListener('error', onChange, true)
  return () => {
    el.removeEventListener('load', onChange, true)
    el.removeEventListener('error', onChange, true)
  }
}

export function findHoverListIndexAtPoint({
  items,
  point,
  popupRect = null,
  edge = 0,
}) {
  if (!Array.isArray(items) || !items.length || !point) return null

  for (const item of items) {
    if (!item?.rect || item.index == null) continue

    if (isPointInsideRect(point, item.rect, edge)) {
      return item.index
    }

    if (!popupRect) continue

    const corridorRect = {
      left: Math.min(item.rect.left, popupRect.left),
      right: Math.max(item.rect.right, popupRect.right),
      top: item.rect.top,
      bottom: item.rect.bottom,
    }

    if (isPointInsideRect(point, corridorRect, edge)) {
      return item.index
    }
  }

  return null
}
