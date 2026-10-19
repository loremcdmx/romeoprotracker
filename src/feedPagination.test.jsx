import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Feed pagination, reading-position restore and the "N new posts" bubble,
// driven through the real App + real usePostsData polling (only the network
// layer is mocked). A poll is triggered the same way the browser does it when
// the tab becomes visible again.

const NOW = Math.floor(Date.now() / 1000)
const META = { startBankroll: 10000, totalTournaments: 100, brHistory: [], lastUpdated: '2026-04-19T02:00:00.000Z' }

// User0 is the newest post; every `romeoEvery`-th post is written by Romeopro.
function makePosts(n, { romeoEvery = 0, likes = 10 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1000 + i),
    author: romeoEvery && i % romeoEvery === 0 ? 'Romeopro' : `User${i}`,
    text: `post number ${i}`,
    likes: typeof likes === 'function' ? likes(i) : likes,
    timestamp: NOW - 3600 - i * 600,
    date: 'x',
    avatar: null,
    rating: 1000,
    msgCount: 50,
    regData: '2021',
    brAfter: null,
    images: [],
    url: `https://forum.gipsyteam.ru/p${i}`,
  }))
}

function makeFresh(id, over = {}) {
  return { ...makePosts(1)[0], id, author: `Fresh${id}`, text: `fresh ${id}`, timestamp: NOW - 5, ...over }
}

let pollCount = 0
function serve(posts) {
  pollCount += 1
  fetchPublicData.mockResolvedValue({
    posts,
    meta: { ...META, lastUpdated: `2026-04-19T03:${String(pollCount % 60).padStart(2, '0')}:00.000Z` },
  })
}

async function renderApp(posts) {
  serve(posts)
  render(<App />)
  await waitFor(() => { if (!document.querySelector('.post-card')) throw new Error('no cards yet') })
}

// Same path as the 2-minute interval: a silent reload when the tab is shown.
async function poll(posts) {
  serve(posts)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

const activePage = () => document.querySelector('.pagination .page-btn.active')?.textContent ?? null
const cardAuthors = () => [...document.querySelectorAll('.post-card .pc-author')].map((n) => n.textContent)
const cardCount = () => document.querySelectorAll('.post-card').length
const rangeText = () => [...document.querySelectorAll('.pagination .page-info')]
  .map((n) => n.textContent).find((text) => text.includes('–'))
const bubble = () => document.querySelector('.new-posts-bubble')

function clickPage(n) {
  fireEvent.click(screen.getAllByLabelText(`${translate('ru', 'page_number')} ${n}`)[0])
}

function openSearchAndType(value) {
  if (!document.querySelector('#feed-search')) {
    fireEvent.click(screen.getByTitle(translate('ru', 'filter_search_title')))
  }
  fireEvent.change(screen.getByPlaceholderText(translate('ru', 'filter_search_placeholder')), { target: { value } })
}

const numInput = (titleKey) => screen.getAllByTitle(translate('ru', titleKey)).find((n) => n.tagName === 'INPUT')

// jsdom has no scrollIntoView; the app calls it from a rAF after 'go to new posts'.
// Without this stub the rAF fires after the test and shows up as an unhandled error.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

function switchLang(label) {
  fireEvent.click([...document.querySelectorAll('.lang-switch-btn')].find((b) => b.textContent === label))
}

describe('feed pagination', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    pollCount = 0
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('a search that leaves exactly two pages opens on page 1 with the first 20 results', async () => {
    await renderApp(makePosts(30))
    expect(activePage()).toBe('1')

    openSearchAndType('post')

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/30/))
    expect(activePage()).toBe('1')
    expect(cardCount()).toBe(20)
    expect(cardAuthors()[0]).toBe('User0')
    expect(rangeText()).toBe('1–20 из 30')
  })

  it('a search typed on a middle page goes back to page 1', async () => {
    await renderApp(makePosts(400))
    clickPage(3)
    await waitFor(() => expect(activePage()).toBe('3'))

    // "post number 1" matches User1, User10-19, User100-199: 111 posts, 6 pages
    openSearchAndType('post number 1')

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/111/))
    expect(activePage()).toBe('1')
    expect(cardAuthors()[0]).toBe('User1')
  })

  it('a search with fewer pages than the current page lands on page 1, not on its last page', async () => {
    // 25 of the 400 posts contain "needle": 2 pages, while the reader is on page 5
    const posts = makePosts(400).map((p, i) => (i % 16 === 0 ? { ...p, text: `needle ${p.text}` } : p))
    await renderApp(posts)
    clickPage(3)
    clickPage(5)
    await waitFor(() => expect(activePage()).toBe('5'))

    openSearchAndType('needle')

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/25/))
    expect(activePage()).toBe('1')
    expect(cardCount()).toBe(20)
  })

  it.each([
    ['sort order', async () => {
      fireEvent.change(screen.getByLabelText(translate('ru', 'filter_sort_label')), { target: { value: 'date_asc' } })
    }],
    ['min likes', async () => {
      fireEvent.change(numInput('filter_min_likes'), { target: { value: '5' } })
    }],
    ['min rating', async () => {
      fireEvent.change(numInput('filter_min_rep'), { target: { value: '500' } })
    }],
    ['Romeo only', async () => {
      fireEvent.click(screen.getByTitle(translate('ru', 'filter_romeo_title')))
    }],
  ])('changing %s goes back to page 1', async (_name, change) => {
    await renderApp(makePosts(600, { romeoEvery: 3 }))
    clickPage(3)
    await waitFor(() => expect(activePage()).toBe('3'))

    await change()

    await waitFor(() => expect(activePage()).toBe('1'))
    expect(cardCount()).toBeGreaterThan(0)
  })

  it.each([3, 5])('starring a post on page %i keeps the reader on that page', async (target) => {
    await renderApp(makePosts(400))
    clickPage(3)
    if (target === 5) clickPage(5)
    await waitFor(() => expect(activePage()).toBe(String(target)))
    const before = cardAuthors()

    const card = document.querySelector('.post-card')
    fireEvent.click(within(card).getByTitle(translate('ru', 'pc_fav_add')))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

    expect(activePage()).toBe(String(target))
    expect(cardAuthors()).toEqual(before)
  })

  it('ignoring an author keeps the reader on the same page', async () => {
    await renderApp(makePosts(400))
    clickPage(3)
    await waitFor(() => expect(activePage()).toBe('3'))

    const card = document.querySelector('.post-card')
    fireEvent.click(within(card).getByTitle(translate('ru', 'pc_ignore')))

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/399/))
    expect(activePage()).toBe('3')
    expect(cardCount()).toBe(20)
  })

  it('ignoring the only post of the last page clamps to the new last page', async () => {
    await renderApp(makePosts(41))
    clickPage(3)
    await waitFor(() => expect(activePage()).toBe('3'))
    expect(cardAuthors()).toEqual(['User40'])

    fireEvent.click(within(document.querySelector('.post-card')).getByTitle(translate('ru', 'pc_ignore')))

    await waitFor(() => expect(activePage()).toBe('2'))
    expect(cardCount()).toBe(20)
  })

  it('switching RU -> EN on the last RU page shows a valid page with a sane range', async () => {
    // RU feed: 600 posts / 30 pages. EN feed: 200 Romeo posts / 10 pages.
    await renderApp(makePosts(600, { romeoEvery: 3 }))
    clickPage(30)
    await waitFor(() => expect(activePage()).toBe('30'))

    switchLang('EN')

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/200 posts/))
    expect(activePage()).toBe('10')
    expect(cardCount()).toBe(20)
    expect(rangeText()).toBe('181–200 / 200')
  })

  it('changing the page size from a deep page shows a valid page', async () => {
    await renderApp(makePosts(400))
    clickPage(3)
    clickPage(5)
    await waitFor(() => expect(activePage()).toBe('5'))

    fireEvent.change(screen.getAllByLabelText(translate('ru', 'per_page_label'))[0], { target: { value: '100' } })

    await waitFor(() => expect(cardCount()).toBe(100))
    expect(activePage()).toBe('1')
    expect(rangeText()).toBe('1–100 из 400')
  })

  it('a poll that shrinks the feed under a deep page never leaves it empty', async () => {
    const posts = makePosts(60)
    await renderApp(posts)
    clickPage(3)
    await waitFor(() => expect(activePage()).toBe('3'))
    expect(cardCount()).toBe(20)

    // The 20 oldest posts drop below the default 3-like threshold: 40 posts, 2 pages.
    await poll(posts.map((p, i) => (i >= 40 ? { ...p, likes: 0 } : p)))

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/40/))
    expect(activePage()).toBe('2')
    expect(cardCount()).toBe(20)
  })
})

describe('reading position restore', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    pollCount = 0
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  const savePos = (index) => localStorage.setItem('rpt_readpos', JSON.stringify({ feed: String(1000 + index) }))

  it('opens on the page of the saved post on the first load', async () => {
    savePos(45) // index 45 of a newest-first feed of 20 per page = page 3
    await renderApp(makePosts(100))
    await waitFor(() => expect(activePage()).toBe('3'))
  })

  it('does not drag the reader back to the saved page when a poll brings a new post', async () => {
    const posts = makePosts(100)
    savePos(45)
    await renderApp(posts)
    await waitFor(() => expect(activePage()).toBe('3'))
    clickPage(1)
    await waitFor(() => expect(activePage()).toBe('1'))

    await poll([makeFresh('fresh-a'), ...posts])

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/101/))
    expect(activePage()).toBe('1')
  })

  it('does not move a reader who hovered the last card of their page when a poll adds a post', async () => {
    const posts = makePosts(60)
    await renderApp(posts)
    const wrappers = [...document.querySelectorAll('[id^="post-"]')]
    fireEvent.mouseEnter(wrappers[wrappers.length - 1]) // saves the last card of page 1

    await poll([makeFresh('fresh-a'), ...posts])

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/61/))
    expect(activePage()).toBe('1')
    expect(cardAuthors()[0]).toBe('Freshfresh-a')
  })

  it('does not re-apply the saved page when a filter is edited later', async () => {
    savePos(45)
    // Even posts have 5 likes, odd ones 10: min-likes 7 changes the feed length.
    await renderApp(makePosts(100, { likes: (i) => (i % 2 ? 10 : 5) }))
    await waitFor(() => expect(activePage()).toBe('3'))
    clickPage(1)
    await waitFor(() => expect(activePage()).toBe('1'))

    fireEvent.change(numInput('filter_min_likes'), { target: { value: '7' } })

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/50/))
    expect(activePage()).toBe('1')
  })

  it('does not restore when the reader changed a filter before the feed first had posts', async () => {
    savePos(45)
    // Every post has 1 like and the default min-likes is 3: the first feed is empty.
    serve(makePosts(100, { likes: 1 }))
    render(<App />)
    await waitFor(() => expect(document.querySelector('.empty-state')).not.toBeNull())
    expect(cardCount()).toBe(0)

    fireEvent.change(numInput('filter_min_likes'), { target: { value: '0' } })

    await waitFor(() => expect(cardCount()).toBe(20))
    expect(activePage()).toBe('1')
  })
})

describe('new posts bubble', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    pollCount = 0
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('stays hidden when every new post is filtered out by min-likes', async () => {
    const posts = makePosts(30)
    await renderApp(posts)

    await poll([...posts, ...[1, 2, 3].map((n) => makeFresh(`low-${n}`, { likes: 0 }))])

    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/30/))
    expect(bubble()).toBeNull()
  })

  it('counts only the new posts the feed shows, and its click lands on one of them', async () => {
    const posts = makePosts(60)
    await renderApp(posts)

    // 2 visible (5 likes) and 3 hidden (0 likes). The visible ones are the
    // OLDEST posts, so they sit on the last page of the date_desc feed.
    const visible = [1, 2].map((n) => makeFresh(`vis-${n}`, { likes: 5, timestamp: NOW - 10 * 86400 - n }))
    const hidden = [1, 2, 3].map((n) => makeFresh(`low-${n}`, { likes: 0 }))
    await poll([...posts, ...visible, ...hidden])

    await waitFor(() => expect(bubble()).not.toBeNull())
    expect(bubble().textContent).toBe('2 новых поста!')
    expect(activePage()).toBe('1')

    fireEvent.click(bubble())

    await waitFor(() => expect(bubble()).toBeNull())
    expect(activePage()).toBe('4') // 62 visible posts, 20 per page
    expect(cardAuthors()).toContain('Freshvis-1')
  })

  it('respects the ignored list and the active search', async () => {
    localStorage.setItem('rpt_ignored', JSON.stringify(['Freshign-1']))
    const posts = makePosts(30)
    await renderApp(posts)
    openSearchAndType('post number')
    await waitFor(() => expect(document.querySelector('.filter-active-count').textContent).toMatch(/30/))

    const ignored = makeFresh('ign-1', { likes: 9, text: 'post number ignored' })
    const offSearch = makeFresh('off-1', { likes: 9, text: 'something else' })
    const match = makeFresh('hit-1', { likes: 9, text: 'post number match' })
    await poll([...posts, ignored, offSearch, match])

    await waitFor(() => expect(bubble()).not.toBeNull())
    expect(bubble().textContent).toBe('1 новый пост!')
  })

  it('in English only counts new Romeo posts', async () => {
    localStorage.setItem('rpt_lang', 'en')
    const posts = makePosts(30, { romeoEvery: 3 })
    await renderApp(posts)

    await poll([...posts, makeFresh('u-1', { likes: 40 }), makeFresh('u-2', { likes: 40 })])
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(bubble()).toBeNull()

    await poll([...posts, makeFresh('u-1', { likes: 40 }), makeFresh('u-2', { likes: 40 }),
      makeFresh('r-1', { author: 'Romeopro', likes: 0 })])
    await waitFor(() => expect(bubble()).not.toBeNull())
    expect(bubble().textContent).toBe('1 new post!')

    fireEvent.click(bubble())
    await waitFor(() => expect(bubble()).toBeNull())
    expect(cardAuthors()[0]).toBe('Romeopro')
    expect(document.getElementById('post-r-1')).not.toBeNull()
  })

  it('follows the filters: lowering min-likes reveals the hidden new posts, raising hides them again', async () => {
    const posts = makePosts(30)
    await renderApp(posts)
    await poll([...posts, makeFresh('low-1', { likes: 0 }), makeFresh('low-2', { likes: 1 })])
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(bubble()).toBeNull()

    fireEvent.change(numInput('filter_min_likes'), { target: { value: '0' } })
    await waitFor(() => expect(bubble()).not.toBeNull())
    expect(bubble().textContent).toBe('2 новых поста!')

    fireEvent.change(numInput('filter_min_likes'), { target: { value: '1' } })
    await waitFor(() => expect(bubble().textContent).toBe('1 новый пост!'))

    fireEvent.change(numInput('filter_min_likes'), { target: { value: '3' } })
    await waitFor(() => expect(bubble()).toBeNull())
  })
})

// A jump (page change, "N new posts" bubble, activity day row) ends with the
// target's top edge under the pinned header stack. The 94-144px offset is a CSS
// scroll-margin-top on .jump-target / .filter-bar (cssCascade.test.js checks the
// numbers per viewport), so the app only has to scroll the right element to the
// top edge: block 'start', not the old fixed 60px / 80px window.scrollTo offsets
// and not 'center' (which hides the top of a post taller than the free space).
describe('jumps scroll the target to the top edge', () => {
  const spy = window.HTMLElement.prototype.scrollIntoView
  const jumpsTo = (el) => {
    const at = spy.mock.contexts.indexOf(el)
    return at === -1 ? null : spy.mock.calls[at][0]
  }

  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    spy.mockClear()
    pollCount = 0
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('a page change scrolls the filter bar to the top edge, after the new page is committed', async () => {
    // what the feed shows at the moment each scroll call is made
    const firstCardAtScroll = []
    spy.mockImplementation(function () {
      if (this.classList.contains('filter-bar')) firstCardAtScroll.push(cardAuthors()[0])
    })
    try {
      await renderApp(makePosts(60))
      clickPage(2)
      await waitFor(() => expect(activePage()).toBe('2'))
      await waitFor(() => expect(jumpsTo(document.querySelector('.filter-bar'))).not.toBeNull())
      expect(jumpsTo(document.querySelector('.filter-bar'))).toEqual({ behavior: 'smooth', block: 'start' })
      // not from inside the click handler (the old page, User0, was still on screen):
      // WebKit cancelled a smooth scroll started there about every other time
      expect(firstCardAtScroll).toEqual(['User20'])
    } finally {
      spy.mockImplementation(() => {})
    }
  })

  it('the new-posts bubble scrolls the first new post wrapper to the top edge', async () => {
    const posts = makePosts(30)
    await renderApp(posts)
    await poll([...posts, makeFresh('hit-1', { likes: 9 })])
    await waitFor(() => expect(bubble()).not.toBeNull())
    fireEvent.click(bubble())
    await waitFor(() => expect(bubble()).toBeNull())
    const wrapper = document.getElementById('post-hit-1')
    await waitFor(() => expect(jumpsTo(wrapper)).not.toBeNull())
    expect(jumpsTo(wrapper)).toEqual({ behavior: 'smooth', block: 'start' })
    expect(wrapper).toHaveClass('jump-target')
  })
})

// goToNewPosts used to end in a "just dismiss" else branch for new posts the
// feed filters hide. The bubble only renders for newInFeed.count > 0, so that
// branch could not run: these cases drive every filter state through the real UI.
describe('goToNewPosts has no dismiss-only path', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    pollCount = 0
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  // two new posts: 0 likes and 1 like; min-likes decides how many the feed shows
  it.each([['3', 0], ['1', 1], ['0', 2]])('min-likes %s: the bubble exists exactly when a new post is in the feed (%i)', async (minLikes, visible) => {
    const posts = makePosts(30)
    await renderApp(posts)
    await poll([...posts, makeFresh('low-1', { likes: 0 }), makeFresh('low-2', { likes: 1 })])
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    fireEvent.change(numInput('filter_min_likes'), { target: { value: minLikes } })
    if (!visible) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(bubble()).toBeNull()
      return
    }
    await waitFor(() => expect(bubble()).not.toBeNull())
    expect(bubble().textContent).toBe(visible === 1 ? '1 новый пост!' : '2 новых поста!')
    fireEvent.click(bubble())
    await waitFor(() => expect(bubble()).toBeNull())
    expect(cardAuthors().some((name) => name.startsWith('Freshlow-'))).toBe(true)
  })

  it('the source keeps the single path: no else branch in goToNewPosts, no stale tab-switch comment', () => {
    const src = readFileSync(resolve(__dirname, 'App.jsx'), 'utf8')
    const body = src.match(/const goToNewPosts = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/)?.[0]
    expect(body, 'goToNewPosts found').toBeTruthy()
    expect(body).not.toMatch(/\belse\b/)
    expect(body).not.toMatch(/dismiss/i)
    const tab = src.match(/\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const switchTab = /)?.[0] ?? ''
    expect(tab, 'switchTab comment found').not.toBe('')
    expect(tab).not.toMatch(/last read post|последним прочитанным/)
  })
})
