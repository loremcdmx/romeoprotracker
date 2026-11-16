import { REAL_HISTORY, replayMeta } from './realHistoryFixture.js'

// Review wave 2026-11-16 (K3): real archive tail after the bundled fixture.
// The real archive after the bundled fixture (2026-10-18 ... 2026-11-15) with the
// per-room bankroll columns: [timestamp, brAfter, result, tournaments, total, rooms before, after].
const GG0 = { ps: 1188, king: 232, coin: 17, lux: 0 }
const R = (before, after) => [{ gg: before, ...GG0 }, { gg: after, ...GG0 }]
const TAIL = [
  [1792379549, 448853, 11926, 156, 40665, ...R(435490, 447416)],
  [1792467158, 458457, 9604, 178, 40843, ...R(447416, 457020)],
  [1792556002, 471528, 13071, 266, 41109, ...R(457020, 470091)],
  [1792903796, 476436, 4908, 228, 41337, ...R(470091, 474999)],
  [1792988743, 467802, -8634, 267, 41604, ...R(474999, 466365)],
  [1793070976, 473911, 6109, 281, 41885, ...R(466365, 472474)],
  [1793154654, 490916, 17005, 172, 42057, ...R(472474, 489479)],
  [1793242005, 501187, 10271, 58, 42115, ...R(489479, 499750)],
  [1793332948, 507143, 5956, 214, 42329, ...R(499750, 505706)],
  [1793419283, 520286, 13143, 168, 42329, ...R(505706, 518849)],
  [1793505417, 526525, 6239, 208, 42705, ...R(518849, 525088)],
  [1793589749, 521352, -5173, 136, 42841, ...R(525088, 519915)],
  [1793682118, 521900, 548, 308, 42841, ...R(519915, 520463)],
  [1793771108, 508858, -13042, 332, 43481, ...R(520463, 507421)],
  [1793848094, 505688, -3170, 138, 43619, ...R(507421, 504251)],
  [1793939258, 496803, -8885, 202, 43821, ...R(504251, 495366)],
  [1794106498, 514374, 17571, 168, 43989, ...R(495366, 512937)],
  [1794190134, 536695, 22321, 165, 44154, ...R(512937, 535258)],
  [1794537342, 531507, -5188, 163, 44317, ...R(535258, 530070)],
  [1794619382, 519774, -11733, 212, 44529, ...R(530070, 518337)],
  [1794719833, 531638, 11864, 374, 44903, ...R(518337, 530201)],
]

export function todayMeta(tail = TAIL) {
  const meta = replayMeta(REAL_HISTORY.length)
  tail.forEach(([timestamp, brAfter, sessionResult, tournaments, totalTournaments, before, after], i) => {
    meta.brHistory.push({
      id: `tail-${i}`, date: `T${i + 1}`, timestamp, brAfter, sessionResult, tournaments,
      totalTournaments, text: `Tail ${i + 1}`,
      rooms: { before, after },
    })
  })
  const last = meta.brHistory.at(-1)
  return { ...meta, bankroll: last.brAfter, day: meta.brHistory.length, totalTournaments: last.totalTournaments,
    lastUpdated: new Date((last.timestamp + 1800) * 1000).toISOString() }
}

// Same shape with the record on the second-to-last report (peak next to the
// right edge, the shape the owner complained about).
export function peakSecondToLastMeta() {
  const tail = TAIL.slice(0, -3).map(r => r.slice())
  const base = tail.at(-1)
  const peak = [base[0] + 86400, base[1] + 24000, 24000, 200, base[4] + 200, base[6], { ...base[6], gg: base[6].gg + 24000 }]
  const last = [peak[0] + 86400, peak[1] - 9000, -9000, 220, peak[4] + 220, peak[6], { ...peak[6], gg: peak[6].gg - 9000 }]
  return todayMeta([...tail, peak, last])
}

