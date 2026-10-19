// Flow tests: the REAL scripts/scrape.mjs - edited forum posts reach the
// dataset, and an edit re-queues the Romeo translation (an unchanged text does not).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'
import { textSignature } from './lib/translation.mjs'

vi.setConfig({ testTimeout: 60_000 })

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

const forumPages = (html, over = {}) => {
  const post = { id: 10, author: over.author || 'A', html, ts: 1_700_000_000, likes: over.likes ?? 0 }
  return { 0: pageHtml([post], 20), 20: pageHtml([post], 20) }
}

describe('SCR-5: forum edits refresh the stored text', () => {
  it('writes the edited body into posts.json and posts.min.json', () => {
    const post = storedPost({ id: 10, text: 'you lose in the long run' })
    const r = run({ posts: [post], pages: forumPages('you lose in the long run, be careful') })
    expect(r.status).toBe(0)
    expect(r.posts[0].text).toBe('you lose in the long run, be careful')
    expect(r.compact.posts[0].x).toBe('you lose in the long run, be careful')
    expect(r.output).toContain('Text: 1 posts refreshed')
  })

  it('picks up improved paragraph structure from the current parser', () => {
    const post = storedPost({ id: 10, text: 'list: - one;- two;- three' })
    const r = run({ posts: [post], pages: forumPages('list:<br>- one;<br>- two;<br>- three') })
    expect(r.posts[0].text).toBe('list:\n- one;\n- two;\n- three')
  })

  it('does not blank a stored body when the scrape returns an empty one', () => {
    const post = storedPost({ id: 10, text: 'a perfectly good stored body' })
    const r = run({ posts: [post], pages: forumPages('') })
    expect(r.posts[0].text).toBe('a perfectly good stored body')
  })

  it('refuses a refresh that would shrink a long body to a stub (degraded page), and says so', () => {
    const long = 'a long stored body, '.repeat(20)
    const post = storedPost({ id: 10, text: long })
    const r = run({ posts: [post], pages: forumPages('Read more...') })
    expect(r.posts[0].text).toBe(long)
    expect(r.output).toContain('Text refresh skipped for 1 post')
  })

  it('still accepts an honest edit that shortens a long body a little', () => {
    const long = 'a long stored body, '.repeat(20)
    const post = storedPost({ id: 10, text: long })
    const r = run({ posts: [post], pages: forumPages('a long stored body, '.repeat(14)) })
    expect(r.posts[0].text).toBe(('a long stored body, '.repeat(14)).trim())
  })

  it('leaves unchanged text exactly as it is', () => {
    const post = storedPost({ id: 10, text: 'same text' })
    const r = run({ posts: [post], pages: forumPages('same text') })
    expect(r.posts[0].text).toBe('same text')
    expect(r.output).not.toContain('Text:')
  })
})

describe('SCR-5: an edit re-queues the translation, no edit does not', () => {
  const oldText = 'Сегодня сыграл 300 турниров, итог плюс две тысячи долларов.'
  const newText = 'Сегодня сыграл 300 турниров, итог МИНУС две тысячи долларов!!'
  const translated = text => ({ ...textSignature(text), en: 'old en', es: 'old es' })

  it('edited Romeo post: new text lands and both translations are redone', () => {
    const post = storedPost({ id: 10, author: 'Romeopro', text: oldText, translations: translated(oldText) })
    const r = run({
      posts: [post], apiKey: 'k', meta: baseMeta(),
      anthropic: { translate: [{ text: 'fresh translation' }] },
      pages: forumPages(newText, { author: 'Romeopro' }),
    })
    const after = r.posts[0]
    expect(after.text).toBe(newText)
    expect(r.count('translate')).toBe(2)
    expect(after.translations).toMatchObject({ ...textSignature(newText), en: 'fresh translation', es: 'fresh translation' })
  })

  it('unchanged Romeo post: no translation call', () => {
    const post = storedPost({ id: 10, author: 'Romeopro', text: oldText, translations: translated(oldText) })
    const r = run({
      posts: [post], apiKey: 'k', meta: baseMeta(),
      anthropic: { translate: [{ text: 'should not be requested' }] },
      pages: forumPages(oldText, { author: 'Romeopro' }),
    })
    expect(r.count('translate')).toBe(0)
    expect(r.posts[0].translations.en).toBe('old en')
  })

  it('edit while the translator is down: the stale translation is not kept under the new signature', () => {
    const post = storedPost({ id: 10, author: 'Romeopro', text: oldText, translations: translated(oldText) })
    const r = run({
      posts: [post], apiKey: 'k', meta: baseMeta(),
      anthropic: { translate: [{ text: 'fresh en' }, { status: 529, raw: 'overloaded' }] },
      pages: forumPages(newText, { author: 'Romeopro' }),
    })
    const tr = r.posts[0].translations
    expect(tr.en).toBe('fresh en')
    expect(tr.es).toBeNull()         // not the old "плюс" translation
  })
})
