// ─── HELPERS ─────────────────────────────────────────────────────────────────
// Russian plural picker. Usage: plural(n, ['сессия','сессии','сессий']).
// Returns the correct form for n: 1 → [0], 2-4 → [1], 0/5+/11-14 → [2].
export function plural(n, forms) {
  const abs = Math.abs(n) % 100
  const mod10 = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (mod10 > 1 && mod10 < 5) return forms[1]
  if (mod10 === 1) return forms[0]
  return forms[2]
}
// Shorthand: returns "N слово" with the correctly declined word
export const pl = (n, forms) => `${n} ${plural(n, forms)}`

export function timeAgo(timestamp) {
  if (!timestamp) return null
  const sec  = Math.floor((Date.now() / 1000) - timestamp)
  if (sec < 60)   return 'только что'
  if (sec < 3600) return pl(Math.floor(sec/60),    ['минуту','минуты','минут']) + ' назад'
  if (sec < 86400) return pl(Math.floor(sec/3600), ['час','часа','часов']) + ' назад'
  if (sec < 2592000) return pl(Math.floor(sec/86400), ['день','дня','дней']) + ' назад'
  if (sec < 31536000) return pl(Math.floor(sec/2592000), ['месяц','месяца','месяцев']) + ' назад'
  return pl(Math.floor(sec/31536000), ['год','года','лет']) + ' назад'
}

export const fmtBR = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : n > 0 ? '+' : ''
  if (abs >= 1_000_000) return s + (abs/1_000_000).toFixed(2) + 'M$'
  if (abs >= 1_000)     return s + (abs/1_000).toFixed(1) + 'k$'
  return s + abs + '$'
}

export const fmtNum = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (abs/1_000_000).toFixed(2) + 'M$'
  if (abs >= 1_000)     return (abs/1_000).toFixed(1) + 'k$'
  return abs + '$'
}

// Целое число с тонким пробелом как разделитель тысяч
export const fmtInt = n => {
  if (n == null || n === '') return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')
}

// Точный формат БР до доллара
export const fmtExact = n => {
  if (!n && n !== 0) return '—'
  const rounded = Math.round(n)
  if (rounded >= 1000) return Math.floor(rounded / 1000) + '\u202F' + String(rounded % 1000).padStart(3, '0') + '$'
  return rounded + '$'
}

const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек']
export function fmtDateShort(timestamp) {
  if (!timestamp) return '—'
  const d = new Date(timestamp * 1000)
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]
}

export function extractDay(text) {
  const m = text?.match(/(?:[Дд]ень|[Dd]ay)\s*#?\s*(\d+)/i)
  return m ? parseInt(m[1]) : null
}

export function extractBR(text) {
  if (!text) return null
  // "после сессии: 9957"
  const m1 = text.match(/(?:после сессии|бр после)[:\s]+(\d[\d\s,]+)/i)
  if (m1) { const n = parseInt(m1[1].replace(/[\s,]/g,'')); if (n > 500 && n < 10_000_000) return n }
  // "$9.9k" формат
  const m2 = text.match(/\$\s?([\d.]+)\s*[kK]/)
  if (m2) { const n = parseFloat(m2[1]) * 1000; if (n > 500 && n < 10_000_000) return n }
  // "банкролл 9957"
  const m3 = text.match(/(?:банкролл|бр)[^\d]{0,20}(\d{4,6})/i)
  if (m3) { const n = parseInt(m3[1]); if (n > 500 && n < 10_000_000) return n }
  return null
}

// Компактный формат числа со знаком (для P&L внутри компонентов)
export const fk = (n, withSign = true) => {
  const a = Math.abs(n)
  const s = withSign ? (n < 0 ? '-' : n > 0 ? '+' : '') : ''
  return a >= 1000 ? s + (a / 1000).toFixed(1) + 'k$' : s + a + '$'
}

export const ROMEO_RE = /romeopro/i

export const autoCloseQuotes = t => {
  const open  = (t.match(/\[QUOTE\]/gi)||[]).length
  const close = (t.match(/\[\/QUOTE\]/gi)||[]).length
  return open > close ? t + '[/QUOTE]'.repeat(open - close) : t
}

// Общая утилита стриппинга цитат
export const stripQuoteTags = t => {
  if (!t) return ''
  let s = t.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').replace(/\[\/QUOTE\]/gi, '').trim()
  const unclosed = s.indexOf('[QUOTE]')
  if (unclosed !== -1) s = s.slice(0, unclosed).trim()
  return s
}

export const extractQuoteBody = t => {
  if (!t) return ''
  const qs = t.indexOf('[QUOTE]')
  if (qs === -1) return ''
  const inner = t.slice(qs + 7)
  const nl = inner.indexOf('\n')
  return (nl !== -1 ? inner.slice(nl + 1) : inner).replace(/\[\/QUOTE\].*/,'').trim()
}

export const fkAbs = v => v >= 1000 ? `${(v/1000).toFixed(1)}k$` : `${Math.round(v)}$`

// ─── MONOTONE CUBIC BEZIER (no overshoot/humps) ─────────────────────────────
// Fritsch–Carlson monotone interpolation: tangents are clamped so the curve
// never overshoots between two data points.
function _monotoneTangents(coords) {
  const n = coords.length
  const dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(coords[i+1].x - coords[i].x)
    dy.push(coords[i+1].y - coords[i].y)
    m.push(dy[i] / (dx[i] || 1e-6))
  }
  const tangents = new Array(n)
  tangents[0] = m[0]
  tangents[n-1] = m[n-2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i-1] * m[i] <= 0) {
      tangents[i] = 0
    } else {
      tangents[i] = (m[i-1] + m[i]) / 2
    }
  }
  // Fritsch–Carlson step 2: clamp alpha/beta so alpha^2+beta^2 <= 9
  // Collect all alpha/beta first, then apply — avoids mutating tangents[i+1]
  // while it's still needed as tangents[i] on the next iteration.
  const clamps = []
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-6) {
      clamps.push({ i, ti: 0, i1: i+1, ti1: 0 })
    } else {
      const a = tangents[i] / m[i]
      const b = tangents[i+1] / m[i]
      const s = a * a + b * b
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        clamps.push({ i, ti: tau * a * m[i], i1: i+1, ti1: tau * b * m[i] })
      }
    }
  }
  for (const c of clamps) {
    tangents[c.i]  = c.ti
    tangents[c.i1] = c.ti1
  }
  return { tangents, dx }
}

export function makeBezierPath(coords) {
  if (coords.length < 2) return ''
  if (coords.length === 2) {
    return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`
  }
  const { tangents, dx } = _monotoneTangents(coords)
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = dx[i] / 3
    const cp1x = coords[i].x + seg
    const cp1y = coords[i].y + tangents[i] * seg
    const cp2x = coords[i+1].x - seg
    const cp2y = coords[i+1].y - tangents[i+1] * seg
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${coords[i+1].x.toFixed(1)} ${coords[i+1].y.toFixed(1)}`
  }
  return d
}

export function makeBezierArea(coords, baseline) {
  if (coords.length < 2) return ''
  if (coords.length === 2) {
    return `M ${coords[0].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${baseline} Z`
  }
  const { tangents, dx } = _monotoneTangents(coords)
  let d = `M ${coords[0].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = dx[i] / 3
    const cp1x = coords[i].x + seg
    const cp1y = coords[i].y + tangents[i] * seg
    const cp2x = coords[i+1].x - seg
    const cp2y = coords[i+1].y - tangents[i+1] * seg
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${coords[i+1].x.toFixed(1)} ${coords[i+1].y.toFixed(1)}`
  }
  return d + ` L ${coords[coords.length-1].x.toFixed(1)} ${baseline} Z`
}
