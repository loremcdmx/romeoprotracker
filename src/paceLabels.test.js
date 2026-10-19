import { describe, expect, it } from 'vitest'
import { paceLabelBox, placePaceValueLabels } from './paceLabels.js'

const label = (key, x, baselines, extra = {}) => ({ key, x, anchor: 'middle', width: 36, baselines, ...extra })
const xLabelRow = (x, width = 30) => ({ left: x - width / 2, right: x + width / 2, top: 200, bottom: 211 })

describe('placePaceValueLabels', () => {
  it('keeps the preferred side when nothing is in the way', () => {
    const placed = placePaceValueLabels([label('a', 100, [60, 88])], [xLabelRow(300)])
    expect(placed.get('a')).toBe(60)
  })

  it('flips a label off the x-axis row when its preferred side is taken', () => {
    // a losing point on the plot floor: the label below it (205) would print on the x label (208)
    const placed = placePaceValueLabels([label('floor', 400, [205, 177])], [xLabelRow(400)], { minY: 0, maxY: 230 })
    expect(placed.get('floor')).toBe(177)
  })

  it('does not move a label that only shares the x-label row horizontally elsewhere', () => {
    const placed = placePaceValueLabels([label('floor', 100, [205, 177])], [xLabelRow(400)], { minY: 0, maxY: 230 })
    expect(placed.get('floor')).toBe(205)
  })

  it('separates two labels on adjacent points, the second goes to the other side', () => {
    const placed = placePaceValueLabels([
      label('last', 500, [50, 78], { keep: true }),
      label('best', 512, [50, 78]),
    ])
    expect(placed.get('last')).toBe(50)
    expect(placed.get('best')).toBe(78)
    const boxes = ['last', 'best'].map(k => paceLabelBox(k === 'last' ? label('l', 500, []) : label('b', 512, []), placed.get(k)))
    expect(boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top).toBe(true)
  })

  it('drops a non-essential label with no free position but always keeps the essential one', () => {
    const wall = { left: 0, right: 1000, top: 0, bottom: 300 }
    const placed = placePaceValueLabels([
      label('last', 100, [50, 78], { keep: true }),
      label('best', 300, [50, 78]),
    ], [wall])
    expect(placed.has('best')).toBe(false)
    expect(placed.get('last')).toBe(50)
  })

  it('treats the vertical bounds as obstacles', () => {
    const placed = placePaceValueLabels([label('top', 100, [4, 32])], [], { minY: 0, maxY: 230 })
    expect(placed.get('top')).toBe(32)
  })

  it('anchors end-aligned labels to their right edge', () => {
    expect(paceLabelBox({ x: 100, anchor: 'end', width: 40 }, 50)).toMatchObject({ left: 60, right: 100 })
    expect(paceLabelBox({ x: 100, anchor: 'middle', width: 40 }, 50)).toMatchObject({ left: 80, right: 120 })
  })
})
