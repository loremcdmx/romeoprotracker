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
  const left = anchor === 'end' ? x - width : x - width / 2
  return { left, right: left + width, top: baseline - ASCENT, bottom: baseline + DESCENT }
}

// labels: in priority order, [{ key, x, anchor, width, baselines: [preferred, ...alternatives], keep }]
// obstacles: rects { left, right, top, bottom } that a label may not touch
// Returns Map(key -> baseline y). A label whose every position collides (with
// an obstacle, an earlier label or the vertical bounds) is left out of the map,
// unless `keep` is set — then it falls back to its preferred position.
export function placePaceValueLabels(labels, obstacles = [], { minY = 0, maxY = Infinity, pad = 2 } = {}) {
  const placed = new Map()
  const taken = [...obstacles]
  for (const label of labels) {
    let chosen = null
    for (const baseline of label.baselines) {
      const box = paceLabelBox(label, baseline)
      if (box.top < minY || box.bottom > maxY) continue
      if (taken.some(other => overlaps(box, other, pad))) continue
      chosen = baseline
      break
    }
    if (chosen == null && label.keep) chosen = label.baselines[0]
    if (chosen == null) continue
    placed.set(label.key, chosen)
    taken.push(paceLabelBox(label, chosen))
  }
  return placed
}
