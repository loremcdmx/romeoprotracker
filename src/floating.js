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
