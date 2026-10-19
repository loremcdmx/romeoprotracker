// Forum-derived data is untrusted: the UI must keep treating exactly one account
// as the marathon author and must never render a non-allow-listed iframe.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(),
}))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const post = (over) => ({
  id: '1', author: 'Romeopro', text: 'Day 5: marathon', likes: 42, timestamp: 1712500000,
  date: '07.04.26', avatar: null, rating: 5000, msgCount: 100, regData: '2020',
  brAfter: null, images: [], videos: [], url: 'https://forum.gipsyteam.ru/x', ...over,
})

function dataWith(posts) {
  return {
    posts,
    meta: {
      startBankroll: 10000, totalTournaments: 3565, day: 5,
      brHistory: [{ id: '1', brAfter: 11000, date: '07.04', timestamp: 1712500000, sessionResult: 1000, text: 'Day 5' }],
      lastUpdated: '2026-04-19T02:00:00.000Z',
    },
  }
}

const cardOf = author => [...document.querySelectorAll('.post-card')]
  .find(card => card.querySelector('.pc-author')?.textContent === author)
const heroDay = () => [...document.querySelectorAll('.hstat')]
  .find(el => el.querySelector('.hstat-label')?.textContent === translate('ru', 'hs_day'))
  ?.querySelector('.hstat-value')?.textContent

describe('look-alike authors (SCR-2 / DL-1 / DL-6)', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('a nick that merely contains romeopro is not styled as Romeo and cannot set the day', async () => {
    fetchPublicData.mockResolvedValue(dataWith([
      post({ id: '1' }),
      post({ id: '2', author: 'RomeoPro_fan', text: 'День 999: fake report', timestamp: 1712600000 }),
    ]))
    render(<App />)
    await waitFor(() => expect(cardOf('RomeoPro_fan')).toBeTruthy())

    expect(cardOf('Romeopro')).toHaveClass('romeo-post')
    expect(cardOf('RomeoPro_fan')).not.toHaveClass('romeo-post')
    expect(heroDay()).toBe('#5')
  })

  it('a casual later Romeo comment does not change the day either (SCR-7 / DL-2)', async () => {
    fetchPublicData.mockResolvedValue(dataWith([
      post({ id: '1' }),
      post({ id: '2', text: 'Сегодня весь день 2 стола играл, отчёт будет позже', timestamp: 1712600000 }),
    ]))
    render(<App />)
    await waitFor(() => expect(document.querySelectorAll('.post-card').length).toBe(2))
    expect(heroDay()).toBe('#5')
  })
})

describe('embedded videos (FD-8 / DL-3 / DL-7)', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  const iframeSrcs = () => [...document.querySelectorAll('.pc-videos iframe')].map(el => el.getAttribute('src'))

  it('renders allow-listed https embeds and drops everything else', async () => {
    fetchPublicData.mockResolvedValue(dataWith([
      post({
        videos: [
          'javascript:parent.__pwned=1',
          '//www.youtube.com/embed/DZl0J-eTjz8',
          'data:text/html,hi',
          'http://www.youtube.com/embed/insecure',
          'https://evil.example/embed/x',
          'https://player.vimeo.com/video/1175524410',
        ],
      }),
    ]))
    render(<App />)
    await waitFor(() => expect(document.querySelector('.pc-videos')).toBeTruthy())
    expect(iframeSrcs()).toEqual([
      '//www.youtube.com/embed/DZl0J-eTjz8',
      'https://player.vimeo.com/video/1175524410',
    ])
  })

  it('renders no video block at all when every src is hostile', async () => {
    fetchPublicData.mockResolvedValue(dataWith([
      post({ text: 'only [VIDEO] here', videos: ['javascript:alert(1)', 'data:text/html,x'] }),
    ]))
    render(<App />)
    await waitFor(() => expect(cardOf('Romeopro')).toBeTruthy())
    expect(document.querySelector('.pc-videos')).toBeNull()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('survives a non-array videos field from hostile data', async () => {
    fetchPublicData.mockResolvedValue(dataWith([
      post({ videos: 'javascript:alert(1)' }),
      post({ id: '2', author: 'Other', videos: { length: 3 } }),
    ]))
    render(<App />)
    await waitFor(() => expect(cardOf('Romeopro')).toBeTruthy())
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(cardOf('Other')).toBeTruthy()
  })
})
