import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

// ─── a tiny CSS cascade ──────────────────────────────────────────────────────
// Not a browser: for one DOM element it finds which declaration of a property
// wins among the rules of app.css (!important, then specificity, then source
// order), evaluating @media/@supports against a given viewport. That is the
// layer the bugs guarded here lived in: a 3-class light rule beating a 2-class
// state rule, a 720px block starting too late for the 980px sidebar, overflow
// on html/body, a z-index that was never compared with the other layers.
// String greps cannot see any of those. Real-browser measurements for the same
// fixes (Chromium + WebKit) are in the commit message.

const CSS = readFileSync(resolve(__dirname, 'app.css'), 'utf8')
const APP_JSX = readFileSync(resolve(__dirname, 'App.jsx'), 'utf8')

function splitTop(text, sep) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === sep && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function parseDecls(body) {
  const decls = []
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const raw = part.slice(i + 1).trim()
    const important = /!\s*important\s*$/i.test(raw)
    const value = raw.replace(/!\s*important\s*$/i, '').trim()
    if (prop === 'overflow') {
      const [x, y = x] = value.split(/\s+/)
      decls.push({ prop: 'overflow-x', value: x, important }, { prop: 'overflow-y', value: y, important })
    } else {
      decls.push({ prop, value, important })
    }
  }
  return decls
}

function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const walk = (src, conds) => {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open < 0) break
      const prelude = src.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < src.length && depth) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      const body = src.slice(open + 1, j - 1)
      if (/^@(media|supports)/i.test(prelude)) walk(body, [...conds, prelude])
      else if (!prelude.startsWith('@')) {
        rules.push({ selectors: splitTop(prelude, ','), decls: parseDecls(body), conds, order: rules.length })
      }
      i = j
    }
  }
  walk(text, [])
  return rules
}

const RULES = parseRules(CSS)

function holds(cond, env) {
  const c = cond.replace(/\s+/g, '')
  if (/^@media/i.test(c)) {
    if (/prefers-reduced-motion/.test(c)) return false
    const max = c.match(/\(max-width:(\d+)px\)/)
    const min = c.match(/\(min-width:(\d+)px\)/)
    const maxH = c.match(/\(max-height:(\d+)px\)/)
    const orient = c.match(/\(orientation:(landscape|portrait)\)/)
    if (!max && !min && !maxH && !orient) return false
    // height features need env.height; an env without one never matches them
    if ((maxH || orient) && env.height === undefined) return false
    return (!max || env.width <= +max[1]) && (!min || env.width >= +min[1])
      && (!maxH || env.height <= +maxH[1])
      && (!orient || (env.width > env.height ? 'landscape' : 'portrait') === orient[1])
  }
  // the only @supports in app.css is the negated overflow-x:clip fallback
  return /^@supportsnot\(/i.test(c) ? env.clip === false : true
}

function specificity(selector) {
  let s = selector
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length
  s = s.replace(/\[[^\]]*\]/g, '')
  const ids = (s.match(/#[\w-]+/g) || []).length
  const pseudoEl = (s.match(/::[\w-]+/g) || []).length
  s = s.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:where\([^)]*\)/g, '')
  s = s.replace(/:(?:not|is)\(/g, '(')
  const classes = (s.match(/\.[\w-]+/g) || []).length
  const pseudoCls = (s.match(/:[\w-]+(\([^)]*\))?/g) || []).length
  const types = (s.replace(/[.#:][\w-]+/g, ' ').replace(/[>+~*()]/g, ' ').match(/(^|\s)[a-zA-Z][\w-]*/g) || []).length
  return [ids, classes + attrs + pseudoCls, types + pseudoEl]
}

function beats(a, b) {
  if (a.important !== b.important) return a.important
  for (let k = 0; k < 3; k++) if (a.spec[k] !== b.spec[k]) return a.spec[k] > b.spec[k]
  return a.order > b.order
}

// winning declaration among the given property names (one "family", e.g.
// background + background-color), or null
function cascade(el, props, env) {
  let best = null
  for (const rule of RULES) {
    if (!rule.conds.every((c) => holds(c, env))) continue
    for (const sel of rule.selectors) {
      let hit = false
      // a state, not a pointer: env.hover evaluates `:hover` as the class `.is-hover` on the element
      try { hit = el.matches(env.hover ? sel.replace(/:hover/g, '.is-hover') : sel) } catch { hit = false }
      if (!hit) continue
      const spec = specificity(sel)
      rule.decls.forEach((d, k) => {
        if (!props.includes(d.prop)) return
        const cand = { ...d, spec, order: rule.order * 1000 + k, sel }
        if (!best || beats(cand, best)) best = cand
      })
    }
  }
  return best
}

const value = (el, prop, env) => cascade(el, [prop], env)?.value

function customProp(el, name, env) {
  for (let n = el; n; n = n.parentElement) {
    const c = cascade(n, [name], env)
    if (c) return c.value
  }
  return undefined
}

function resolveVars(v, el, env) {
  return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) => {
    const found = customProp(el, name, env)
    if (found === undefined) return fallback !== undefined ? fallback.trim() : ''
    return resolveVars(found, el, env)
  })
}

function px(v, el, env) {
  const expr = resolveVars(v, el, env).replace(/calc/g, '').replace(/px/g, '')
  if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error(`not a px expression: ${v}`)
  return Function(`"use strict";return (${expr})`)()
}

function mount(html, { light = false } = {}) {
  document.documentElement.className = light ? 'light' : ''
  document.body.innerHTML = html
}
const $ = (sel) => document.querySelector(sel)

// WCAG 2.x contrast
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

// colours with alpha: "#rgb", "#rrggbb", rgb()/rgba() -> [r, g, b, a]
function toRGBA(v) {
  const s = String(v).trim()
  let m = s.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1)
  m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16)).concat(1)
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  throw new Error(`not a colour: ${v}`)
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
// the colour a (possibly translucent) foreground actually paints over an opaque background
const over = (fg, bg, opacity = 1) => {
  const [r, g, b, a] = toRGBA(fg)
  const k = a * opacity
  const B = toRGBA(bg)
  return toHex([r * k + B[0] * (1 - k), g * k + B[1] * (1 - k), b * k + B[2] * (1 - k)])
}
const colourTokens = (v) => String(v).match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []

const phone = { width: 375, clip: true }
const wide = { width: 1280, clip: true }

beforeEach(() => {
  document.documentElement.className = ''
  document.body.innerHTML = ''
})

describe('app.css cascade guards', () => {
  it('sanity: the mini cascade resolves a known dark/light pair', () => {
    mount('<div class="hstat"><div class="hstat-value green"></div></div>')
    const el = $('.hstat-value')
    expect(resolveVars(value(el, 'color', wide), el, wide)).toBe('#66bb6a')
    mount('<div class="hstat"><div class="hstat-value green"></div></div>', { light: true })
    expect(resolveVars(value($('.hstat-value'), 'color', wide), $('.hstat-value'), wide)).toBe('#27682c')
    expect(RULES.length).toBeGreaterThan(100)
  })

  describe('sticky header (CSS-1)', () => {
    const STICKY_CHAIN = '<div id="root"><header class="topbar"></header><div class="marathon-progress"></div><main class="page"><div><button class="new-posts-bubble"></button></div></main></div>'
    const scrollers = new Set(['hidden', 'auto', 'scroll'])

    it.each([320, 375, 414, 720, 721, 980, 1280])('no ancestor of a sticky element becomes a scroll container at %ipx', (width) => {
      mount(STICKY_CHAIN)
      const env = { width, clip: true }
      for (const el of [document.documentElement, document.body, $('#root'), $('.page'), $('.page > div')]) {
        for (const axis of ['overflow-x', 'overflow-y']) {
          // overflow:hidden on html AND body made body a (non-scrolling) scroll
          // container, so .topbar/.marathon-progress never stuck at <=720px
          expect(scrollers.has(value(el, axis, env)), `${el.tagName}${el.id ? '#' + el.id : ''}.${el.className} ${axis} @${width}px`).toBe(false)
        }
      }
    })

    it('clips horizontal overflow on phones with overflow-x:clip, hidden only where clip is unsupported', () => {
      mount(STICKY_CHAIN)
      expect(value(document.documentElement, 'overflow-x', phone)).toBe('clip')
      expect(value(document.body, 'overflow-x', phone)).toBe('clip')
      const old = { width: 375, clip: false }
      expect(value(document.documentElement, 'overflow-x', old)).toBe('hidden')
      expect(value(document.body, 'overflow-x', old)).toBe('hidden')
    })
  })

  describe('new-posts bubble sits below the sticky stack (CSS-4 / SH-8)', () => {
    // Measured in Chromium and WebKit at 320-2560px, ru/en/es, week/month/all:
    // .marathon-progress is 70px tall (69-71 with sub-pixel zoom) from 721px up
    // and 104px once its grid stacks at <=720px. If the bar's layout changes,
    // update --progress-h in app.css and these numbers together.
    it.each([[375, 104], [720, 104], [721, 70], [820, 70], [1280, 70], [1920, 70]])('at %ipx the bubble starts 8px under a %ipx progress bar', (width, barH) => {
      mount('<div id="root"><header class="topbar"></header><div class="marathon-progress"></div><main class="page"><div><button class="new-posts-bubble"></button></div></main></div>')
      const env = { width, clip: true }
      const barTop = px(value($('.marathon-progress'), 'top', env), $('.marathon-progress'), env)
      const bubbleTop = px(value($('.new-posts-bubble'), 'top', env), $('.new-posts-bubble'), env)
      expect(barTop).toBe(40)
      expect(bubbleTop).toBe(barTop + barH + 8)
    })
  })

  describe('jump offset follows the sticky stack, short landscape pins the topbar only (tails T2 a/b)', () => {
    const CHAIN = '<div id="root"><header class="topbar"></header><div class="marathon-progress"></div><div class="filter-bar"></div><main class="page"><div id="post-1" class="jump-target"></div><button class="new-posts-bubble"></button></main></div>'
    const env = (width, height, extra = {}) => ({ width, height, clip: true, ...extra })
    const stackOf = (e) => px('var(--sticky-stack-h)', document.documentElement, e)
    const pos = (sel, e) => value($(sel), 'position', e)

    // [width, height, stack]: stack = topbar 45 (landscape) or --progress-top 40 + bar 70/104
    const LANDSCAPE = [[667, 375, 45], [812, 375, 45], [568, 320, 45], [932, 430, 45], [1280, 480, 45], [740, 500, 45]]
    const UNCHANGED = [[375, 812, 144], [320, 640, 144], [414, 896, 144], [768, 1024, 110], [1024, 768, 110], [1280, 800, 110], [1920, 1080, 110],
      [812, 501, 110], [667, 501, 144], [375, 500, 144], [320, 480, 144]]

    it.each(LANDSCAPE)('%ix%i landscape: stack is the topbar only (%ipx), the progress bar scrolls away, the topbar stays pinned', (w, h, stack) => {
      for (const light of [false, true]) {
        mount(CHAIN, { light })
        const e = env(w, h)
        expect(stackOf(e)).toBe(stack)
        expect(pos('.marathon-progress', e)).toBe('static')
        expect(pos('.topbar', e)).toBe('sticky')
        expect(px(value($('.topbar'), 'top', e), $('.topbar'), e)).toBe(0)
      }
    })

    it.each(UNCHANGED)('%ix%i keeps the two-row pinned stack (%ipx) and both bars sticky', (w, h, stack) => {
      for (const light of [false, true]) {
        mount(CHAIN, { light })
        const e = env(w, h)
        expect(stackOf(e)).toBe(stack)
        expect(pos('.marathon-progress', e)).toBe('sticky')
        expect(pos('.topbar', e)).toBe('sticky')
        expect(px(value($('.marathon-progress'), 'top', e), $('.marathon-progress'), e)).toBe(40)
      }
    })

    it.each([[375, 812], [768, 1024], [1280, 800], [667, 375]])('--topbar-h is the real topbar at %ix%i: the 44px row plus its 1px bottom border', (w, h) => {
      mount('<header class="topbar"><div class="topbar-inner"></div></header>')
      const e = env(w, h)
      const row = px(value($('.topbar-inner'), 'height', e), $('.topbar-inner'), e)
      const border = parseFloat(value($('.topbar'), 'border-bottom', e))
      expect(row + border).toBe(px('var(--topbar-h)', document.documentElement, e))
    })

    it('an env without a height never matches the height query (older call sites stay on the portrait/desktop rules)', () => {
      mount(CHAIN)
      expect(stackOf({ width: 667, clip: true })).toBe(144)
      expect(pos('.marathon-progress', { width: 667, clip: true })).toBe('sticky')
    })

    it.each([...LANDSCAPE, ...UNCHANGED])('%ix%i: the new-posts bubble pins 8px under whatever is pinned (stack %ipx)', (w, h, stack) => {
      mount(CHAIN)
      const e = env(w, h)
      expect(px(value($('.new-posts-bubble'), 'top', e), $('.new-posts-bubble'), e)).toBe(stack + 8)
    })

    // goToPost / goToNewPosts land on .jump-target (the post
    // wrapper), goPage on .filter-bar: both leave 12px under the pinned stack.
    // The old JS offsets were a fixed 80px (post) and 60px (filter bar) from the
    // viewport top, below the 94-137px desktop and 144px phone stack.
    it.each([...LANDSCAPE, ...UNCHANGED])('%ix%i: jump targets keep %ipx + 12px clear of the top', (w, h, stack) => {
      mount(CHAIN)
      const e = env(w, h)
      for (const sel of ['.jump-target', '.filter-bar']) {
        const v = value($(sel), 'scroll-margin-top', e)
        expect(v, `${sel} has a scroll-margin-top`).toBeDefined()
        expect(px(v, $(sel), e), `${sel} @${w}x${h}`).toBe(stack + 12)
      }
    })

    // Keyboard focus (WCAG 2.4.11): Tab / focus() only scrolled a control into the
    // viewport, which left it behind the pinned stack. The browser's own focus scroll
    // honours scroll-margin-top, so the same value on every focusable (zoom-aware,
    // unlike an html scroll-padding-top) keeps it 12px below the stack.
    const FOCUSABLES = ['a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'div[tabindex]', 'g[tabindex]']
    const FOCUS_HTML = '<div id="root"><header class="topbar"></header><div class="marathon-progress"></div><main class="page"><div id="post-1" class="jump-target"><a href="#">l</a><button>b</button><input><select></select><textarea></textarea><details><summary>s</summary></details><div tabindex="0">d</div><svg><g tabindex="0"></g></svg><span>plain</span></div></main></div>'

    it.each([...LANDSCAPE, ...UNCHANGED])('%ix%i: every focusable keeps focus scrolling %ipx + 12px clear of the top', (w, h, stack) => {
      for (const light of [false, true]) {
        mount(FOCUS_HTML, { light })
        const e = env(w, h)
        for (const sel of FOCUSABLES) {
          const el = $(`#post-1 ${sel}`)
          const v = value(el, 'scroll-margin-top', e)
          expect(v, `${sel} has a scroll-margin-top`).toBeDefined()
          expect(px(v, el, e), `${sel} @${w}x${h}`).toBe(stack + 12)
        }
        // only focus targets carry it: it must not become a blanket margin on plain content
        expect(value($('#post-1 span'), 'scroll-margin-top', e)).toBeUndefined()
      }
    })

    // Focusing a control that is itself pinned must not scroll the page (the margin
    // dragged it up by up to 150px, measured in Chromium and WebKit), and a control
    // inside a fixed popup that scrolls on its own must not over-scroll the popup.
    const PINNED = '<div id="root"><header class="topbar"><div class="topbar-inner"><button class="topbar-tab"></button><a href="#">a</a><details class="mobile-menu"><summary>m</summary><div class="mobile-menu-panel"><button>x</button></div></details></div></header><div class="marathon-progress"></div><main class="page"><button class="new-posts-bubble"></button><div class="chart-tooltip"><div tabindex="0">t</div><button>c</button></div><div class="mc-tooltip"><a href="#">m</a></div><div class="sidebar-popup"><a href="#">s</a><button>p</button></div></main></div>'
    it.each([...LANDSCAPE, ...UNCHANGED])('%ix%i: controls in the topbar, the new-posts bubble and the fixed popups keep the browser default', (w, h) => {
      mount(PINNED)
      const e = env(w, h)
      for (const sel of ['.topbar-tab', '.topbar a', '.topbar summary', '.mobile-menu-panel button', '.new-posts-bubble', '.chart-tooltip div[tabindex]', '.chart-tooltip button', '.mc-tooltip a', '.sidebar-popup a', '.sidebar-popup button']) {
        const el = $(sel)
        const v = value(el, 'scroll-margin-top', e)
        expect(v, `${sel} is reset`).toBeDefined()
        expect(px(v, el, e), `${sel} @${w}x${h}`).toBe(0)
      }
    })

    it('every in-page jump goes through the one helper, with no fixed pixel offset left in App.jsx', () => {
      // one smooth request, in scrollToJumpTarget; the other two scrollIntoView calls are
      // snapToJumpTarget's instant re-ask (and its fallback for engines without 'instant')
      expect(APP_JSX.match(/\.scrollIntoView\(\{ behavior: scrollBehavior\(\)/g)).toHaveLength(1)
      expect(APP_JSX.match(/\.scrollIntoView\(/g)).toHaveLength(3)
      expect(APP_JSX).toMatch(/function scrollToJumpTarget\(el\) \{\s*el\.scrollIntoView\(\{ behavior: scrollBehavior\(\), block: 'start' \}\)\s*settleOnJumpTarget\(el\)/)
      expect(APP_JSX).toMatch(/function snapToJumpTarget\(el\) \{\s*try \{ el\.scrollIntoView\(\{ behavior: 'instant', block: 'start' \}\) \}/)
      expect(APP_JSX).not.toMatch(/window\.scrollTo\(/)
      expect(APP_JSX).not.toMatch(/block:\s*'center'/)
      // the definition plus its three callers: goPage, goToPost, goToNewPosts
      expect(APP_JSX.match(/scrollToJumpTarget\(/g)).toHaveLength(4)
      // the post wrapper that goToPost / goToNewPosts look up by id carries the class
      expect(APP_JSX).toMatch(/id=\{`post-\$\{p\.id\}`\} className="jump-target"/)
    })

    // scrollToPost was the fallback of DayEventsList for a missing onPostClick. It was
    // dead code: DayEventsList is private to App.jsx, ActivityChart (its only parent)
    // is rendered once with goToPost, and its tooltip hands over its own wrapper.
    it('has no scrollToPost fallback: every DayEventsList gets onPostClick and ActivityChart is handed goToPost', () => {
      expect(APP_JSX).not.toMatch(/scrollToPost/)
      expect(APP_JSX).not.toMatch(/^export[^\n]*DayEventsList/m)
      const uses = [...APP_JSX.matchAll(/<DayEventsList\b/g)].map((m) => APP_JSX.slice(m.index, APP_JSX.indexOf('/>', m.index)))
      expect(uses).toHaveLength(3)
      for (const jsx of uses) expect(jsx, 'a DayEventsList without onPostClick would click through to nothing').toMatch(/onPostClick=\{/)
      const charts = [...APP_JSX.matchAll(/<ActivityChart\b/g)].map((m) => APP_JSX.slice(m.index, APP_JSX.indexOf('/>', m.index)))
      expect(charts).toHaveLength(1)
      expect(charts[0]).toMatch(/onPostClick=\{goToPost\}/)
      expect(APP_JSX).toMatch(/const goToPost = useCallback\(/)
    })
  })

  describe('721-980px keeps what the hidden sidebar carried (CSS-6 / SH-7)', () => {
    const FEED = '<aside class="sidebar"></aside><div class="hero"><div class="hero-stats"></div></div><div class="mobile-stats"><div class="mobile-stat"><div class="mobile-stat-value"></div></div></div><div class="mobile-stats-note"></div><div class="mobile-top-posts"><div class="mobile-top-header"></div><a class="mobile-top-item"></a></div>'
    const show = (width) => {
      mount(FEED)
      const env = { width, clip: true }
      const d = (sel) => value($(sel), 'display', env)
      return { sidebar: d('.sidebar'), heroStats: d('.hero-stats'), stats: d('.mobile-stats'), note: d('.mobile-stats-note'), top: d('.mobile-top-posts'), topHeader: d('.mobile-top-header'), topItem: d('.mobile-top-item') }
    }

    it.each([375, 720, 721, 768, 820, 900, 980])('at %ipx the stat strip and top list replace the hero tiles and the sidebar', (width) => {
      expect(show(width)).toEqual({ sidebar: 'none', heroStats: 'none', stats: 'grid', note: 'block', top: 'block', topHeader: 'flex', topItem: 'flex' })
    })

    it.each([981, 1280, 1920])('at %ipx the sidebar is back and the strip/list are hidden', (width) => {
      const s = show(width)
      expect(s.sidebar).not.toBe('none')
      expect(s).toMatchObject({ heroStats: 'grid', stats: 'none', note: 'none', top: 'none' })
    })

    it('uses 3 columns on tablets and 2 on phones', () => {
      mount(FEED)
      expect(value($('.mobile-stats'), 'grid-template-columns', { width: 768, clip: true })).toMatch(/^repeat\(3,/)
      expect(value($('.mobile-stats'), 'grid-template-columns', phone)).toMatch(/^repeat\(2,/)
    })
  })

  describe('light theme accents (CSS-2)', () => {
    const light = (width = 1280) => ({ width, clip: true })
    const surfaces = () => {
      mount('<div></div>', { light: true })
      const root = document.documentElement
      const v = (n) => customProp(root, n, light())
      // page, card, red-tinted badge, and the two stops of the hero gradient
      return [v('--bg'), v('--bg2'), v('--red-dim'), '#f3e9e6', '#ece8e0']
    }
    const colourOf = (html, sel, env, prop) => {
      mount(html, { light: true })
      const el = $(sel)
      const v = value(el, prop, env)
      return v === undefined ? undefined : resolveVars(v, el, env)
    }

    const CASES = [
      ['hero profit', '<div class="hstat"><div class="hstat-value green"></div></div>', '.hstat-value'],
      ['hero day/rank', '<div class="hstat"><div class="hstat-value gold"></div></div>', '.hstat-value'],
      ['hero loss', '<div class="hstat"><div class="hstat-value red"></div></div>', '.hstat-value'],
      ['sidebar row green', '<div class="srow"><span class="srow-val green"></span></div>', '.srow-val'],
      ['mobile stat green', '<div class="mobile-stat"><div class="mobile-stat-value green"></div></div>', '.mobile-stat-value', 'color', 768],
      ['mobile stat gold', '<div class="mobile-stat"><div class="mobile-stat-value gold"></div></div>', '.mobile-stat-value', 'color', 768],
      ['feed likes +', '<div class="pc-foot"><span class="pc-likes pos"></span></div>', '.pc-likes'],
      ['feed likes -', '<div class="pc-foot"><span class="pc-likes neg"></span></div>', '.pc-likes'],
      ['bankroll badge', '<div class="pc-foot"><span class="pc-br"></span></div>', '.pc-br'],
      ['forum link', '<div class="sblock"><div class="sblock-body"><a href="#"></a></div></div>', '.sblock-body a'],
      ['marathon tooltip profit +', '<div class="mc-tooltip"><span class="mc-session-profit pos"></span></div>', '.mc-session-profit'],
      ['marathon tooltip profit -', '<div class="mc-tooltip"><span class="mc-session-profit neg"></span></div>', '.mc-session-profit'],
      ['pace unit', '<section class="pace-widget"><div class="pace-summary-panel marathon-progress-side"><div class="mps-item"><span class="mps-value tempo-val"><span class="tempo-unit"></span></span></div></div></section>', '.tempo-unit'],
      ['pace trend rate +', '<section class="pace-widget"><div class="pace-summary-panel marathon-progress-side"><div class="mps-item"><span class="mps-value"><span class="pace-rate-value pos"></span></span></div></div></section>', '.pace-rate-value'],
      ['pace trend rate -', '<section class="pace-widget"><div class="pace-summary-panel marathon-progress-side"><div class="mps-item"><span class="mps-value"><span class="pace-rate-value neg"></span></span></div></div></section>', '.pace-rate-value'],
      ['pace chart value +', '<section class="pace-widget"><svg><g class="pace-segment pos"><text class="pace-chart-value pos"></text></g></svg></section>', '.pace-chart-value', 'fill'],
      ['pace chart value -', '<section class="pace-widget"><svg><g class="pace-segment neg"><text class="pace-chart-value neg"></text></g></svg></section>', '.pace-chart-value', 'fill'],
      // inline #4caf50 / #ff5252 / #ffb74d / #66bb6a in App.jsx moved onto classes so the theme can re-tune them
      ['author rating +', '<div class="pc-author-meta"><a class="pc-rating pos"></a></div>', '.pc-rating'],
      ['author rating -', '<div class="pc-author-meta"><a class="pc-rating neg"></a></div>', '.pc-rating'],
      ['activity tooltip rating', '<div class="chart-tooltip"><span class="ac-rating"></span></div>', '.ac-rating'],
      ['activity tooltip likes', '<div class="chart-tooltip"><span class="ac-likes"></span></div>', '.ac-likes'],
      ['marathon tooltip pill +', '<div class="mc-tooltip"><div class="mc-pill pos"></div></div>', '.mc-pill'],
      ['marathon tooltip pill -', '<div class="mc-tooltip"><div class="mc-pill neg"></div></div>', '.mc-pill'],
    ]

    it.each(CASES)('%s reaches 4.5:1 on every light surface', (_label, html, sel, prop = 'color', width = 1280) => {
      const fg = colourOf(html, sel, light(width), prop)
      expect(String(fg), `${_label} resolves to a plain hex colour`).toMatch(/^#[0-9a-f]{6}$/i)
      for (const bg of surfaces()) expect(contrast(fg, bg), `${_label} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })

    it('the --green-hi token behind the inline bankroll colour is AA in light and unchanged in dark', () => {
      mount('<div></div>', { light: true })
      const fg = customProp(document.documentElement, '--green-hi', light())
      for (const bg of surfaces()) expect(contrast(fg, bg), `--green-hi ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      mount('<div></div>')
      expect(customProp(document.documentElement, '--green-hi', wide)).toBe('#66bb6a')
    })

    it('keeps the dark pace tooltip readable inside the light theme', () => {
      mount('<section class="pace-widget"><div class="pace-point-tooltip"><b class="pos"></b><b class="neg"></b></div></section>', { light: true })
      for (const sel of ['.pos', '.neg']) {
        const el = $(`.pace-point-tooltip ${sel}`)
        const fg = resolveVars(value(el, 'color', light()), el, light())
        expect(contrast(fg, '#121212'), `${sel} ${fg} on the dark tooltip`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('leaves the dark theme accents exactly as they were', () => {
      const dark = { width: 1280, clip: true }
      const pick = (html, sel, prop = 'color') => { mount(html); const el = $(sel); return resolveVars(value(el, prop, dark), el, dark) }
      expect(pick('<div class="hstat"><div class="hstat-value green"></div></div>', '.hstat-value')).toBe('#66bb6a')
      expect(pick('<div class="hstat"><div class="hstat-value gold"></div></div>', '.hstat-value')).toBe('#ffb300')
      expect(pick('<div class="pc-foot"><span class="pc-likes pos"></span></div>', '.pc-likes')).toBe('#4caf50')
      expect(pick('<div class="pc-foot"><span class="pc-br"></span></div>', '.pc-br')).toBe('#ff5252')
      expect(pick('<section class="pace-widget"><text class="pace-chart-value pos"></text></section>', '.pace-chart-value', 'fill')).toBe('#7ee787')
      expect(pick('<section class="pace-widget"><div class="pace-summary-panel marathon-progress-side"><div class="mps-item"><span class="mps-value tempo-val"><span class="tempo-unit"></span></span></div></div></section>', '.tempo-unit')).toBe('rgba(220,220,220,.62)')
    })
  })

  describe('session dots in the light theme (CSS-5)', () => {
    // the app marks dots it thins out as minor + hidden; a plain hidden one is covered too
    const DOTS = '<svg class="mc-svg"><circle class="mc-dot mc-dot-minor mc-dot-hidden"></circle><circle class="mc-dot mc-dot-hidden"></circle><circle class="mc-dot mc-dot-minor"></circle><circle class="mc-dot"></circle></svg>'
    it.each([['light', 1280, true], ['light', 375, true], ['dark', 1280, false], ['dark', 375, false]])('%s theme at %ipx: hidden dots stay invisible and minor dots keep no outline', (_name, width, isLight) => {
      mount(DOTS, { light: isLight })
      const env = { width, clip: true }
      for (const el of document.querySelectorAll('.mc-dot-hidden')) expect(value(el, 'opacity', env), el.getAttribute('class')).toBe('0')
      for (const el of document.querySelectorAll('.mc-dot-minor')) expect(value(el, 'stroke', env), el.getAttribute('class')).toBe('none')
      // an ordinary dot still gets the theme ring
      expect(value($('.mc-svg .mc-dot:not(.mc-dot-hidden):not(.mc-dot-minor)'), 'stroke', env)).not.toBe('none')
    })
  })

  describe('light theme period pills (tablet exposure of the mobile top list)', () => {
    it.each([375, 768, 980])('the active top-posts period keeps its red fill in the light theme at %ipx', (width) => {
      mount('<div class="mobile-top-posts"><div class="mobile-top-periods"><button class="mobile-top-period active"></button><button class="mobile-top-period"></button></div></div>', { light: true })
      const env = { width, clip: true }
      const fill = cascade($('.mobile-top-period.active'), ['background', 'background-color'], env)
      // solid red that carries white text at AA (--red-fill), still a red fill and not cream
      expect(fill.value).toBe('var(--red-fill)')
    })
  })

  describe('light theme pagination (same cascade trap as the dots)', () => {
    it.each([[true], [false]])('the active page button keeps its red fill (light=%s)', (isLight) => {
      mount('<nav><button class="page-btn active"></button><button class="page-btn"></button></nav>', { light: isLight })
      expect(cascade($('.page-btn.active'), ['background', 'background-color'], wide).value).toBe(isLight ? 'var(--red-fill)' : 'var(--red)')
      expect(cascade($('.page-btn:not(.active)'), ['background', 'background-color'], wide).value).toBe('var(--bg2)')
    })
  })

  describe('light theme leftovers: white-on-red fills, resting icons, rate hint, empty card', () => {
    const lightEnv = (width = 1280) => ({ width, clip: true })
    const BG = ['background', 'background-color', 'background-image']
    const resolved = (el, props, env) => { const c = cascade(el, props, env); return c && resolveVars(c.value, el, env) }
    // same cream surfaces as the accent table above, plus the pale card the pace widget paints (#f8f6f2)
    const surfacesOf = () => {
      mount('<div></div>', { light: true })
      const root = document.documentElement
      const v = (n) => customProp(root, n, lightEnv())
      return [v('--bg'), v('--bg2'), v('--red-dim'), '#f3e9e6', '#ece8e0', '#f8f6f2']
    }

    const FILLS = [
      ['hero badge', '<div class="hero-name"><span class="hero-badge"></span></div>', '.hero-badge'],
      ['filter pill (on)', '<div class="filter-bar"><button class="filter-pill filter-romeo on"></button></div>', '.filter-pill'],
      ['marathon period (active)', '<div class="mc-periods"><button class="mc-period active"></button></div>', '.mc-period'],
      ['pace period (active)', '<section class="pace-widget"><div class="pace-periods"><button class="mc-period active"></button></div></section>', '.mc-period'],
      ['page button (active)', '<nav><button class="page-btn active"></button></nav>', '.page-btn'],
      ['mobile top period (active)', '<div class="mobile-top-posts"><div class="mobile-top-periods"><button class="mobile-top-period active"></button></div></div>', '.mobile-top-period'],
      ['mobile menu nav button (active)', '<div class="mobile-menu-nav"><button class="active"></button></div>', '.mobile-menu-nav button'],
      ['mobile menu language button (active)', '<div class="mobile-menu-languages"><button class="active"></button></div>', '.mobile-menu-languages button'],
    ]
    // the mobile top list exists below 980px only (the sidebar carries it above)
    const widthsFor = (label) => (label.startsWith('mobile top') ? [320, 375, 768] : [320, 375, 768, 1280])
    const FILL_CASES = FILLS.flatMap(([label, html, sel]) => widthsFor(label).map((w) => [label, w, html, sel]))

    it.each(FILL_CASES)('%s at %ipx: white text on a red fill that is >=4.5:1 at every gradient stop', (label, width, html, sel) => {
      mount(html, { light: true })
      const el = $(sel)
      const env = lightEnv(width)
      const text = toHex(toRGBA(resolved(el, ['color'], env)))
      const stops = colourTokens(resolved(el, BG, env))
      expect(stops.length, `${label} has a colour background`).toBeGreaterThan(0)
      for (const stop of stops) {
        const [r, g, b] = toRGBA(stop)
        // still the theme's red (the CSS-5 trap painted these cream, which white cannot be read on)
        expect(r > g * 2 && r > b * 2, `${label} ${stop} is red`).toBe(true)
        expect(contrast(text, toHex(toRGBA(stop))), `${label} ${text} on ${stop}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it.each([
      ['filter pill (on)', '<div class="filter-bar"><button class="filter-pill filter-romeo on"></button></div>', '.filter-pill'],
      ['page button (active)', '<nav><button class="page-btn active"></button></nav>', '.page-btn'],
      ['mobile top period (active)', '<div class="mobile-top-posts"><div class="mobile-top-periods"><button class="mobile-top-period active"></button></div></div>', '.mobile-top-period'],
      ['mobile menu nav button (active)', '<div class="mobile-menu-nav"><button class="active"></button></div>', '.mobile-menu-nav button'],
    ])('%s has a rim in the same red as its fill in light (no brighter outline)', (_label, html, sel) => {
      mount(html, { light: true })
      const el = $(sel)
      const env = lightEnv(768)
      expect(resolved(el, ['border-color'], env)).toBe(resolved(el, BG, env))
    })

    it.each([[true], [false]])('an active period button hovered keeps white text, as it did before (light=%s)', (isLight) => {
      for (const html of ['<div class="mc-periods"><button class="mc-period active is-hover"></button></div>', '<section class="pace-widget"><div class="pace-periods"><button class="mc-period active is-hover"></button></div></section>']) {
        mount(html, { light: isLight })
        const el = $('.mc-period')
        expect(resolved(el, ['color'], { ...lightEnv(), hover: true })).toBe('#fff')
      }
    })

    it('the feed star/ignore buttons rest at an AA opacity in light, and hover / .on still reach 1', () => {
      const surfaces = surfacesOf() // before mounting: it remounts the body
      mount('<div class="pc-actions"><button class="pc-action"></button><button class="pc-action on"></button><button class="pc-action is-hover"></button></div>', { light: true })
      const [rest, on, hover] = document.querySelectorAll('.pc-action')
      const env = lightEnv()
      const opacityOf = (el, e = env) => Number(resolved(el, ['opacity'], e))
      const text = resolved(rest, ['color'], env)
      expect(text).toMatch(/^#[0-9a-f]{6}$/i)
      for (const bg of surfaces) {
        // the pre-fix .5 painted #2a2824 at 2.96:1 on the card
        expect(contrast(over(text, bg, opacityOf(rest)), bg), `rest on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(opacityOf(on)).toBe(1)
      expect(opacityOf(hover, { ...env, hover: true })).toBe(1)
    })

    it('the inline rate hint beside the projection is AA on the light surfaces, opacity included', () => {
      const surfaces = surfacesOf()
      mount('<span class="mps-value-row"><span class="mps-rate-inline"></span></span>', { light: true })
      const el = $('.mps-rate-inline')
      const env = lightEnv()
      const colour = resolved(el, ['color'], env)
      const opacity = Number(resolved(el, ['opacity'], env))
      for (const bg of [...surfaces, '#f3f1ed']) expect(contrast(over(colour, bg, opacity), bg), `${colour} x${opacity} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })

    it.each([320, 375, 768, 1280])('the empty-period card keeps a visible dashed outline in light at %ipx', (width) => {
      const surfaces = surfacesOf()
      mount('<section class="pace-widget"><div class="pace-chart-empty"></div></section>', { light: true })
      const el = $('.pace-chart-empty')
      const env = lightEnv(width)
      const border = resolved(el, ['border', 'border-color'], env)
      expect(border).toMatch(/dashed|^#/)
      const outline = colourTokens(border).at(-1)
      // a boundary needs 3:1 against what it sits on; the pre-fix white 9% was 1.01:1
      for (const bg of surfaces) expect(contrast(over(outline, bg), bg), `${outline} on ${bg}`).toBeGreaterThanOrEqual(3)
    })

    it('keeps the tinted pill border that the inline style used to force over the neutral light one', () => {
      for (const isLight of [true, false]) {
        for (const [tone, border] of [['pos', 'rgba(102,187,106,.25)'], ['neg', 'rgba(255,82,82,.25)']]) {
          mount(`<div class="mc-tooltip"><div class="mc-pill ${tone}"></div></div>`, { light: isLight })
          const el = $('.mc-pill')
          expect(cascade(el, ['border', 'border-color'], wide).value, `${tone} light=${isLight}`).toBe(border)
        }
      }
    })

    it('leaves every dark-theme value touched here exactly as it was', () => {
      const dark = { width: 1280, clip: true }
      const get = (html, sel, props) => { mount(html); const el = $(sel); return resolved(el, props, dark) }
      // moved from inline styles to classes: the dark colours are the literals they replaced
      expect(get('<div class="pc-author-meta"><a class="pc-rating pos"></a></div>', '.pc-rating', ['color'])).toBe('#4caf50')
      expect(get('<div class="pc-author-meta"><a class="pc-rating neg"></a></div>', '.pc-rating', ['color'])).toBe('#ff5252')
      expect(get('<div class="chart-tooltip"><span class="ac-rating"></span></div>', '.ac-rating', ['color'])).toBe('#4caf50')
      expect(get('<div class="chart-tooltip"><span class="ac-likes"></span></div>', '.ac-likes', ['color'])).toBe('#ffb74d')
      expect(get('<div class="mc-tooltip"><div class="mc-pill pos"></div></div>', '.mc-pill', ['color'])).toBe('#66bb6a')
      expect(get('<div class="mc-tooltip"><div class="mc-pill neg"></div></div>', '.mc-pill', ['color'])).toBe('#ff5252')
      // light-only overrides must not leak into dark
      expect(get('<div class="hero-name"><span class="hero-badge"></span></div>', '.hero-badge', BG)).toBe('#e53935')
      expect(get('<div class="filter-bar"><button class="filter-pill on"></button></div>', '.filter-pill', BG)).toBe('#e53935')
      expect(colourTokens(get('<div class="mc-periods"><button class="mc-period active"></button></div>', '.mc-period', BG))).toEqual(['#ef5350', '#d73c39'])
      expect(colourTokens(get('<section class="pace-widget"><div class="pace-periods"><button class="mc-period active"></button></div></section>', '.mc-period', BG))).toEqual(['#ef5350', '#d73c39'])
      expect(get('<div class="pc-actions"><button class="pc-action"></button></div>', '.pc-action', ['opacity'])).toBe('.5')
      expect(get('<span class="mps-value-row"><span class="mps-rate-inline"></span></span>', '.mps-rate-inline', ['opacity'])).toBe('.8')
      expect(get('<span class="mps-value-row"><span class="mps-rate-inline"></span></span>', '.mps-rate-inline', ['color'])).toBe('#c9a46a')
      expect(get('<section class="pace-widget"><div class="pace-chart-empty"></div></section>', '.pace-chart-empty', ['border', 'border-color'])).toBe('1px dashed rgba(255,255,255,.09)')
    })
  })

  describe('light theme AA: the last text below 4.5:1 (U1)', () => {
    const BG = ['background', 'background-color', 'background-image']
    const env = (width = 1280, extra = {}) => ({ width, clip: true, ...extra })
    const resolved = (el, props, e) => { const c = cascade(el, props, e); return c && resolveVars(c.value, el, e) }
    const token = (name, isLight = true) => { mount('<div></div>', { light: isLight }); return customProp(document.documentElement, name, wide) }
    // cards the day-event rows sit on: plain, the red tint of a Romeo row, the green tint of a session row, the hovered (--bg2) row
    const dayCards = () => {
      const bg3 = token('--bg3'); const bg2 = token('--bg2')
      const tintOf = (cls) => { mount(`<div class="day-event ${cls}"></div>`, { light: true }); return colourTokens(resolved($('.day-event'), BG, wide))[0] }
      return [bg3, over(tintOf('day-event-romeo'), bg3), over(tintOf('day-event-session'), bg3), bg2]
    }

    it('the "last: N" chip in the session widget is AA on its chip background', () => {
      for (const width of [320, 375, 1280]) {
        mount('<div class="section-head"><span class="section-count smtt-last-chip"></span></div>', { light: true })
        const el = $('.smtt-last-chip')
        const e = env(width)
        // .light .section-count (2 classes, earlier) must not win the colour: the chip rule is the later 2-class rule
        expect(cascade(el, ['color'], e).sel).toBe('.light .smtt-last-chip')
        const fg = resolved(el, ['color'], e)
        const bg = resolved(el, ['background', 'background-color'], e)
        expect(fg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(contrast(fg, bg), `chip ${fg} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
        for (const surface of [token('--bg'), token('--bg2')]) expect(contrast(fg, surface), `chip ${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('the x label of a partial pace segment is AA with its opacity applied', () => {
      const surfaces = ['#f9f7f3', '#f8f6f2', token('--bg2'), '#f3f1ed']
      for (const width of [320, 375, 768, 1280]) {
        mount('<section class="pace-widget"><svg><g class="pace-segment pos partial"><text class="pace-x-label"></text></g></svg></section>', { light: true })
        const el = $('.pace-x-label')
        const e = env(width)
        const fg = resolved(el, ['fill'], e)
        const opacity = Number(resolved(el, ['opacity'], e))
        for (const bg of surfaces) expect(contrast(over(fg, bg, opacity), bg), `${fg} x${opacity} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('the y labels of the marathon chart keep AA on phones, where the media rule dims them', () => {
      const surfaces = [token('--bg2'), token('--bg')]
      for (const width of [320, 375, 720, 721, 1280]) {
        mount('<svg class="mc-svg"><g class="mc-y-tick"><text class="mc-yaxis-label"></text></g></svg>', { light: true })
        const el = $('.mc-yaxis-label')
        const e = env(width)
        const fg = resolved(el, ['fill'], e)
        const opacity = Number(resolved(el, ['opacity'], e))
        for (const bg of surfaces) expect(contrast(over(fg, bg, opacity), bg), `${fg} x${opacity} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it.each([
      ['likes pill', '<div class="day-event day-event-reply"><span class="day-event-likes"></span></div>', '.day-event-likes', true],
      ['positive result pill', '<div class="day-event day-event-session"><span class="day-event-pill pos"></span></div>', '.day-event-pill', true],
      ['negative result pill', '<div class="day-event day-event-session"><span class="day-event-pill neg"></span></div>', '.day-event-pill', true],
      ['Romeo author', '<div class="day-event day-event-romeo"><span class="day-event-author"></span></div>', '.day-event-author', false],
      ['session author', '<div class="day-event day-event-session"><span class="day-event-author"></span></div>', '.day-event-author', false],
    ])('day-event %s is AA on every card the row can sit on', (label, html, sel, hasPillBg) => {
      const cards = dayCards()
      for (const width of [375, 1280]) {
        mount(html, { light: true })
        const el = $(sel)
        const e = env(width)
        const fg = resolved(el, ['color'], e)
        expect(fg, `${label} resolves to a plain hex colour`).toMatch(/^#[0-9a-f]{6}$/i)
        const pill = hasPillBg ? resolved(el, ['background', 'background-color'], e) : null
        for (const card of cards) {
          const bg = pill ? over(pill, card) : card
          expect(contrast(fg, bg), `${label} ${fg} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it('the positive month profit in the marathon month details is AA on the card and the page', () => {
      for (const width of [375, 1280]) {
        mount('<div class="mc-month-details"><dl><dd class="mc-month-profit-pos"></dd></dl></div>', { light: true })
        const fg = resolved($('dd'), ['color'], env(width))
        for (const s of [token('--bg2'), token('--bg')]) expect(contrast(fg, s), `month profit + ${fg} on ${s} @${width}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('the negative month profit stays AA on the chart card', () => {
      mount('<div class="mc-month-details"><dl><dd class="mc-month-profit-neg"></dd></dl></div>', { light: true })
      const fg = resolved($('dd'), ['color'], env())
      expect(contrast(fg, token('--bg2')), `month profit - ${fg}`).toBeGreaterThanOrEqual(4.5)
    })

    it.each([['last'], ['recovery'], ['best'], ['worst']])('the %s x-axis sub label is AA on the chart card', (tone) => {
      for (const width of [375, 1280]) {
        mount(`<svg><g class="mc-x-tick ${tone}"><text class="mc-xaxis-label-sub"></text></g></svg>`, { light: true })
        const fg = resolved($('.mc-xaxis-label-sub'), ['fill'], env(width))
        expect(contrast(fg, token('--bg2')), `${tone} sub label ${fg} @${width}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    // the pulse that flashes for 700ms when the tempo changes: in the sticky progress bar, and inside the pace panel
    it.each([
      ['progress bar', '<div class="marathon-progress"><div class="marathon-progress-side"><span class="mps-value tempo-val pulse"></span></div></div>'],
      ['pace panel', '<section class="pace-widget"><div class="pace-summary-panel marathon-progress-side"><span class="mps-value tempo-val pulse"></span></div></section>'],
    ])('the tempo value pulse in the %s is AA', (_label, html) => {
      for (const width of [375, 1280]) {
        mount(html, { light: true })
        const fg = resolved($('.tempo-val'), ['color'], env(width))
        for (const s of [token('--bg'), token('--bg2'), '#f1eee9']) expect(contrast(fg, s), `tempo pulse ${fg} on ${s} @${width}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    // measured wrongly once: the contrast scan hid <text> fills but not <tspan> fills, so the glyph ink was averaged into the
    // "background" (203,222,205) and read 3.55-3.78. On the real plate (rgba(255,255,255,.96)) both are AA already; this keeps them so.
    it.each([
      ['milestone callout value', '<svg><g class="mc-milestone-callout"><text class="mc-milestone-label"><tspan class="mc-milestone-primary"></tspan></text></g></svg>', '.mc-milestone-primary'],
      ['milestone callout date', '<svg><g class="mc-milestone-callout"><text class="mc-milestone-label"><tspan class="mc-milestone-secondary"></tspan></text></g></svg>', '.mc-milestone-secondary'],
      ['peak callout "PEAK" kicker', '<svg><g class="mc-peak-callout"><text class="mc-peak-callout-text"><tspan class="mc-peak-callout-kicker"></tspan></text></g></svg>', '.mc-peak-callout-kicker'],
    ])('%s is AA on the callout plate over every light surface', (label, html, sel) => {
      const surfaces = [token('--bg'), token('--bg2'), token('--red-dim'), '#f3e9e6', '#ece8e0', '#f9f7f3']
      for (const width of [375, 1280]) {
        mount(html, { light: true })
        const el = $(sel)
        const e = env(width)
        const fg = resolved(el, ['fill'], e)
        const plate = customProp(document.documentElement, '--chart-callout-bg', e)
        for (const surface of surfaces) {
          const bg = over(plate, surface)
          expect(contrast(fg, bg), `${label} ${fg} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    describe('white on red fills that still read --red', () => {
      const ACTIVE = [
        ['activity period (desktop)', '<div><button class="ac-period active"></button></div>', '.ac-period'],
        ['activity period (phone)', '<div><button class="ac-period ac-period-mobile active"></button></div>', '.ac-period'],
        ['settings choice', '<div class="settings-choice-group"><button class="active"></button></div>', '.settings-choice-group button'],
      ]
      const CASES = ACTIVE.flatMap(([label, html, sel]) => [320, 375, 768, 1280].flatMap((w) => [false, true].map((hover) => [label, w, hover, html, sel])))

      it.each(CASES)('%s at %ipx (hover=%s): white on a solid red fill that is >=4.5:1 in light, the old --red in dark', (label, width, hover, html, sel) => {
        const e = env(width, { hover })
        const html2 = hover ? html.replace('class="', 'class="is-hover ') : html
        mount(html2, { light: true })
        let el = $(sel)
        const text = resolved(el, ['color'], e)
        const fill = resolved(el, BG, e)
        expect(text.toLowerCase()).toBe('#fff')
        expect(fill, `${label} fill`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(contrast(toHex(toRGBA(text)), fill), `${label} ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5)
        expect(resolved(el, ['border-color'], e), `${label} rim matches the fill`).toBe(fill)
        mount(html2, { light: false })
        el = $(sel)
        expect(cascade(el, BG, e).value, `${label} dark fill`).toBe('var(--red)')
        expect(cascade(el, ['border-color'], e).value, `${label} dark rim`).toBe('var(--red)')
        expect(resolved(el, ['color'], e).toLowerCase()).toBe('#fff')
      })

      it('the inactive activity period buttons look as the inline style made them, in both themes', () => {
        for (const isLight of [false, true]) {
          for (const [cls, padding] of [['ac-period', '3px 7px'], ['ac-period ac-period-mobile', '4px 8px']]) {
            mount(`<div><button class="${cls}"></button></div>`, { light: isLight })
            const el = $('.ac-period')
            const get = (p) => cascade(el, [p], env()).value
            expect(cascade(el, BG, env()).value, `${cls} light=${isLight}`).toBe('var(--bg3)')
            expect(get('border')).toBe('1px solid var(--border2)')
            expect(get('color')).toBe('var(--dim2)')
            expect(get('border-radius')).toBe('4px')
            expect(get('font-size')).toBe('10px')
            expect(get('font-weight')).toBe('600')
            expect(get('font-family')).toBe('inherit')
            expect(get('cursor')).toBe('pointer')
            expect(get('padding')).toBe(padding)
          }
        }
      })

      it('no inline style is left on the activity chart period buttons (an inline background cannot be overridden by .light)', () => {
        const parts = APP_JSX.split('{PERIOD_LABELS[k]}')
        expect(parts).toHaveLength(3) // the phone list and the desktop list
        for (const part of parts.slice(0, -1)) {
          const tag = part.slice(part.lastIndexOf('<button'))
          expect(tag).not.toMatch(/style=/)
          expect(tag).toMatch(/className=\{'ac-period/)
        }
        expect(APP_JSX).not.toMatch(/period===k\?'var\(--red\)'/)
      })
    })

    describe('inline var(--red) the CSS re-binds per group (the inline style itself is not ours to move)', () => {
      it('the sidebar top-posts period buttons read a red that carries white text in light, and the old --red in dark', () => {
        // the buttons are inline: background/border var(--red), color #fff when active
        expect(APP_JSX).toMatch(/background:sideTopPeriod===k\?'var\(--red\)'.*border:'1px solid '\+\(sideTopPeriod===k\?'var\(--red\)'.*color:sideTopPeriod===k\?'#fff'/)
        for (const width of [375, 768, 1280]) {
          mount('<div class="forum-top-head"><div class="forum-top-periods"><button></button></div></div>', { light: true })
          const fill = resolveVars('var(--red)', $('.forum-top-periods button'), env(width))
          expect(contrast('#ffffff', fill), `white on ${fill} @${width}`).toBeGreaterThanOrEqual(4.5)
        }
        mount('<div class="forum-top-head"><div class="forum-top-periods"><button></button></div></div>')
        expect(resolveVars('var(--red)', $('.forum-top-periods button'), wide)).toBe('#e53935')
      })

      it('the footer changelog version tags read a red that is AA on the light surfaces, the old --red in dark', () => {
        expect(APP_JSX).toMatch(/<span style=\{\{fontSize:9,color:'var\(--red\)'/)
        const surfaces = [token('--bg'), token('--bg2'), token('--bg3')]
        for (const width of [375, 1280]) {
          mount('<footer><div><span></span></div></footer>', { light: true })
          const fg = resolveVars('var(--red)', $('footer span'), env(width))
          for (const bg of surfaces) expect(contrast(fg, bg), `${fg} on ${bg} @${width}`).toBeGreaterThanOrEqual(4.5)
        }
        mount('<footer><div><span></span></div></footer>')
        expect(resolveVars('var(--red)', $('footer span'), wide)).toBe('#e53935')
      })
    })

    it('leaves every dark-theme value touched here exactly as it was', () => {
      const dark = (width = 1280) => env(width)
      const get = (html, sel, props, width) => { mount(html); const el = $(sel); return resolved(el, props, dark(width)) }
      expect(get('<div class="section-head"><span class="section-count smtt-last-chip"></span></div>', '.smtt-last-chip', ['color'])).toBe('#ffb300')
      expect(get('<div class="section-head"><span class="section-count smtt-last-chip"></span></div>', '.smtt-last-chip', ['border-color'])).toBe('rgba(255,210,77,.35)')
      const xl = '<section class="pace-widget"><svg><g class="pace-segment pos partial"><text class="pace-x-label"></text></g></svg></section>'
      expect(get(xl, '.pace-x-label', ['opacity'])).toBe('.64')
      expect(get(xl, '.pace-x-label', ['fill'])).toBe('rgba(230,230,230,.86)')
      const yl = '<svg class="mc-svg"><g class="mc-y-tick"><text class="mc-yaxis-label"></text></g></svg>'
      expect(get(yl, '.mc-yaxis-label', ['opacity'], 375)).toBe('.84')
      expect(get(yl, '.mc-yaxis-label', ['opacity'], 1280)).toBe('.92')
      expect(get(yl, '.mc-yaxis-label', ['fill'], 375)).toBe('#b8b8b8')
      expect(get('<div class="day-event day-event-reply"><span class="day-event-likes"></span></div>', '.day-event-likes', ['color'])).toBe('#ffb74d')
      expect(get('<div class="day-event day-event-session"><span class="day-event-pill pos"></span></div>', '.day-event-pill', ['color'])).toBe('#66bb6a')
      expect(get('<div class="day-event day-event-session"><span class="day-event-pill neg"></span></div>', '.day-event-pill', ['color'])).toBe('#ef5350')
      expect(get('<div class="day-event day-event-romeo"><span class="day-event-author"></span></div>', '.day-event-author', ['color'])).toBe('#e53935')
      expect(get('<div class="day-event day-event-session"><span class="day-event-author"></span></div>', '.day-event-author', ['color'])).toBe('#e53935')
      expect(get('<div class="mc-month-details"><dl><dd class="mc-month-profit-pos"></dd></dl></div>', 'dd', ['color'])).toBe('#76d982')
      expect(get('<svg><g class="mc-x-tick last"><text class="mc-xaxis-label-sub"></text></g></svg>', '.mc-xaxis-label-sub', ['fill'])).toBe('#f3d88b')
      expect(get('<svg><g class="mc-x-tick recovery"><text class="mc-xaxis-label-sub"></text></g></svg>', '.mc-xaxis-label-sub', ['fill'])).toBe('#b7dfba')
      expect(get('<svg><g class="mc-x-tick best"><text class="mc-xaxis-label-sub"></text></g></svg>', '.mc-xaxis-label-sub', ['fill'])).toBe('#bee8c2')
      expect(get('<div class="marathon-progress"><div class="marathon-progress-side"><span class="mps-value tempo-val pulse"></span></div></div>', '.tempo-val', ['color'])).toBe('#ffd479')
      expect(get('<svg><g class="mc-milestone-callout"><text class="mc-milestone-label"><tspan class="mc-milestone-primary"></tspan></text></g></svg>', '.mc-milestone-primary', ['fill'])).toBe('#75cf70')
      expect(get('<svg><g class="mc-peak-callout"><text class="mc-peak-callout-text"><tspan class="mc-peak-callout-kicker"></tspan></text></g></svg>', '.mc-peak-callout-kicker', ['fill'])).toBe('#ffb300')
    })
  })

  describe('lightbox (CSS-7 / CSS-8)', () => {
    it('is the topmost layer, above every other z-index in the stylesheet and the inline 9999 popups', () => {
      const lightbox = Number(value(Object.assign(document.body.appendChild(document.createElement('div')), { className: 'lightbox' }), 'z-index', wide))
      const others = []
      for (const rule of RULES) {
        if (rule.selectors.includes('.lightbox')) continue
        for (const d of rule.decls) if (d.prop === 'z-index' && /^\d+$/.test(d.value)) others.push(Number(d.value))
      }
      for (const m of APP_JSX.matchAll(/zIndex:\s*(\d+)/g)) others.push(Number(m[1]))
      expect(Math.max(...others)).toBeGreaterThanOrEqual(9999)
      expect(lightbox).toBeGreaterThan(Math.max(...others))
    })

    it.each([[1920, 'max-width'], [1920, 'max-height'], [375, 'max-width'], [375, 'max-height']])('at %ipx the image %s is a share of the overlay, not vw/vh', (width, prop) => {
      // #root is zoomed 0.85-1.25 on desktop and vw/vh caps are scaled by that
      // zoom (92vh -> 115vh at 1.25), which cropped tall screenshots
      mount('<div id="root"><div class="lightbox"><img></div></div>')
      const v = value($('.lightbox img'), prop, { width, clip: true })
      expect(v).toMatch(/%$/)
      expect(v).not.toMatch(/v[wh]/)
    })
  })
})
