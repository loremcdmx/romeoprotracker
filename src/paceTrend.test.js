import { describe, expect, it } from 'vitest'
import { buildPaceTrend, computePaceTrendStats } from './paceTrend.js'

describe('pace trend helpers', () => {
  it('uses only full bins for trend stats', () => {
    const stats = computePaceTrendStats([
      { endMtt:2000, rate:6, full:true },
      { endMtt:4000, rate:12, full:true },
      { endMtt:4500, rate:-90, full:false },
    ])

    expect(stats).toMatchObject({
      endMtt:4000,
      rising:true,
    })
    expect(stats.endRate).toBeCloseTo(12)
  })

  it('builds a visible SVG path from zero to the plot edge (fit on full bins only)', () => {
    const trend = buildPaceTrend([
      { endMtt:2000, rate:6, full:true },
      { endMtt:4000, rate:12, full:true },
      { endMtt:4500, rate:-90, full:false },
    ], {
      maxMtt:4500,
      maxAbs:12,
      xByMtt:mtt => mtt / 10,
      y:rate => 100 - rate,
    })

    // slope fitted on the two full bins (0.003 $/MTT), drawn to maxMtt=4500;
    // the extrapolated rate (13.5) clamps to maxAbs=12
    expect(trend.path).toBe('M 0.0 100.0 L 450.0 88.0')
    expect(trend.endX).toBe(450)
  })
})
