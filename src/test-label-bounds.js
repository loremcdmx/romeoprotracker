// Test-only helper (not imported by the app). jsdom does no layout, so the
// width of an SVG Y tick label is estimated: Roboto Mono advances 0.6em per
// character and the widest Y-label font size in app.css is 10.6px. The labels
// are right-aligned (text-anchor:end) at their `x`, so `x - width` is the left
// edge that must stay inside the SVG canvas (>= 0) or the browser clips it.
export const MONO_ADVANCE_PX = 0.6 * 10.6

export function labelLeftEdge(label) {
  return Number(label.getAttribute('x')) - label.textContent.length * MONO_ADVANCE_PX
}
