// Collision handling for the pace chart's point value labels (best / worst /
// latest). Labels used to sit at a fixed offset from their dot, so a negative
// extreme at the plot floor printed on top of the x-axis labels and two close
// points printed on top of each other. Like the trend-label solver, this works
// in SVG user units on estimated text boxes.

// Font 10.5px with a 2px halo: glyphs reach ~8.5 above and ~3 below the baseline.
const ASCENT = 9
const DESCENT = 3

function overlaps(a, b, pad) {
  return a.left - pad < b.right && b.left - pad < a.right
    && a.top - pad < b.bottom && b.top - pad < a.bottom
}

export function paceLabelBox({ x, anchor = 'middle', width }, baseline) {
  const left = anchor === 'end' ? x - width : anchor === 'start' ? x : x - width / 2
  return { left, right: left + width, top: baseline - ASCENT, bottom: baseline + DESCENT }
}

// labels: in priority order, [{ key, x, anchor, width, baselines: [preferred, ...alternatives], keep }]
// obstacles: rects { left, right, top, bottom } that a label may not touch
// Returns Map(key -> baseline y). A label whose every position collides (with
// an obstacle, an earlier label or the vertical bounds) is left out of the map,
// unless `keep` is set — then it falls back to its preferred position.
export function placePaceValueLabels(labels, obstacles = [], bounds = {}) {
  const spots = placePaceLabelSpots(labels.map(label => ({
    ...label,
    positions: label.baselines.map(baseline => ({ x: label.x, anchor: label.anchor || 'middle', baseline })),
  })), obstacles, bounds)
  return new Map([...spots].map(([key, spot]) => [key, spot.baseline]))
}

// Does the segment a-b touch the rect (grown by pad)? Liang-Barsky clipping.
export function segmentTouchesRect(a, b, rect, pad = 0) {
  const left = rect.left - pad, right = rect.right + pad, top = rect.top - pad, bottom = rect.bottom + pad
  const dx = b.x - a.x, dy = b.y - a.y
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue }
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
  }
  return true
}

export function polylineTouchesRect(points, rect, pad = 0) {
  for (let i = 0; i + 1 < points.length; i++) if (segmentTouchesRect(points[i], points[i + 1], rect, pad)) return true
  return false
}

// Points along an SVG path made of M / L / C commands (what buildSmoothSvgPath
// and the trend line emit); curves are sampled so a label can be tested
// against the line as it is really drawn.
export function samplePacePath(d, steps = 16) {
  const out = []
  const tokens = String(d || '').match(/[MLC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []
  let i = 0, cmd = null, cur = null
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/^[MLC]$/i.test(tokens[i])) cmd = tokens[i++].toUpperCase()
    if (cmd === 'M' || cmd === 'L') {
      cur = { x: num(), y: num() }
      out.push(cur)
    } else if (cmd === 'C') {
      const c1 = { x: num(), y: num() }, c2 = { x: num(), y: num() }, end = { x: num(), y: num() }
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t
        out.push({
          x: u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        })
      }
      cur = end
    } else break
  }
  return out
}

// Same idea as placePaceValueLabels, but a label may move sideways too:
// label.positions = [{ x, anchor, baseline }] in preference order. A position
// is rejected when its box leaves the bounds, touches an obstacle or an earlier
// label, touches label.avoid (rects, e.g. the dots) or is crossed by a line in
// label.avoidPaths (polylines). Returns Map(key -> { x, anchor, baseline }).
export function placePaceLabelSpots(labels, obstacles = [], { minX = -Infinity, maxX = Infinity, minY = 0, maxY = Infinity, pad = 2 } = {}) {
  const placed = new Map()
  const taken = [...obstacles]
  const boxOf = (label, pos) => paceLabelBox({ x: pos.x, anchor: pos.anchor, width: label.width }, pos.baseline)
  const fits = (label, pos, withPaths) => {
    const box = boxOf(label, pos)
    if (box.top < minY || box.bottom > maxY || box.left < minX || box.right > maxX) return false
    if (taken.some(other => overlaps(box, other, pad))) return false
    if ((label.avoid || []).some(other => overlaps(box, other, pad))) return false
    return !withPaths || !(label.avoidPaths || []).some(path => polylineTouchesRect(path, box, label.pathPad ?? pad))
  }
  for (const label of labels) {
    // A `keep` label that cannot avoid every line still must not sit on a dot,
    // another label or the axis: lines are the soft constraint.
    let chosen = label.positions.find(pos => fits(label, pos, true))
      || (label.keep ? label.positions.find(pos => fits(label, pos, false)) : null)
    if (chosen == null && label.keep) chosen = label.positions[0]
    if (chosen == null) continue
    placed.set(label.key, chosen)
    taken.push(boxOf(label, chosen))
  }
  return placed
}
