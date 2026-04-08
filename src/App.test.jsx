import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App.jsx'

// Mock fetch for data loading
vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(() => Promise.resolve({
    posts: [
      {
        id: '1', author: 'Romeopro', text: 'День #5 марафона. После сессии: 11000',
        likes: 42, timestamp: 1712500000, date: '07.04.26',
        avatar: null, rating: 5000, msgCount: 100, regData: '2020',
        brAfter: 11000, images: [], url: 'https://forum.gipsyteam.ru/test1',
      },
      {
        id: '2', author: 'TestUser', text: 'Интересный пост о покере',
        likes: 10, timestamp: 1712400000, date: '06.04.26',
        avatar: null, rating: 1000, msgCount: 50, regData: '2021',
        brAfter: null, images: [], url: 'https://forum.gipsyteam.ru/test2',
      },
      {
        id: '3', author: 'Romeopro', text: '[QUOTE]somebody\ncited text[/QUOTE]Мой ответ',
        likes: 100, timestamp: 1712300000, date: '05.04.26',
        avatar: null, rating: 5000, msgCount: 100, regData: '2020',
        brAfter: 10500, images: ['https://example.com/img.jpg'], url: 'https://forum.gipsyteam.ru/test3',
      },
    ],
    meta: {
      startBankroll: 10000,
      totalTournaments: 3565,
      brHistory: [
        { brAfter: 10500, date: '05.04', timestamp: 1712300000, sessionResult: 500, text: 'День #3' },
        { brAfter: 11000, date: '07.04', timestamp: 1712500000, sessionResult: 500, text: 'День #5' },
      ],
    },
  })),
}))

// Suppress Vercel Analytics in tests
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('renders loading state then content', async () => {
    render(<App />)
    const elements = await screen.findAllByText('Romeopro')
    expect(elements.length).toBeGreaterThan(0)
  })

  it('renders hero stats', async () => {
    render(<App />)
    expect(await screen.findByText('Банкролл')).toBeInTheDocument()
    // "Профит" appears in hero and sidebar
    expect(screen.getAllByText('Профит').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('День марафона').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Сыграно МТТ').length).toBeGreaterThanOrEqual(1)
  })

  it('renders marathon chart', async () => {
    render(<App />)
    expect(await screen.findByText(/График марафона/)).toBeInTheDocument()
  })

  it('renders post cards in feed', async () => {
    render(<App />)
    const elements = await screen.findAllByText('Romeopro')
    // Hero + post cards + sidebar
    expect(elements.length).toBeGreaterThan(1)
  })

  it('renders topbar with tabs', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    // Both topbar and mobile nav have tabs
    expect(screen.getAllByText('Лента').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Темы').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Настройки').length).toBeGreaterThanOrEqual(1)
  })

  it('switches to topics tab', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const tabs = screen.getAllByText('Темы')
    fireEvent.click(tabs[0])
    expect(screen.getByText(/Марафон/)).toBeInTheDocument()
    expect(screen.getByText(/Обсуждение/)).toBeInTheDocument()
    expect(screen.getByText(/Дебаты/)).toBeInTheDocument()
  })

  it('switches to settings tab and shows ignore list', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const tabs = screen.getAllByText('Настройки')
    fireEvent.click(tabs[0])
    expect(screen.getByText(/Игнорируемые авторы/)).toBeInTheDocument()
  })

  it('toggles theme', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const themeBtn = screen.getByTitle(/тема/i)
    fireEvent.click(themeBtn)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    fireEvent.click(themeBtn)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('renders sidebar with stats', async () => {
    render(<App />)
    expect(await screen.findByText('📊 Статистика')).toBeInTheDocument()
  })

  it('renders sidebar top posts section', async () => {
    render(<App />)
    expect(await screen.findByText(/Больше всего плюсиков/)).toBeInTheDocument()
  })

  it('renders footer with version and changelog', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    // v1.5.1 may appear in footer and changelog entry
    expect(screen.getAllByText('v1.5.1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Changelog')).toBeInTheDocument()
  })

  it('renders pagination', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const pageInfos = screen.getAllByText(/из/)
    expect(pageInfos.length).toBeGreaterThan(0)
  })

  it('renders filter bar with romeo filter', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    const romeoButtons = screen.getAllByText('Ромео')
    expect(romeoButtons.length).toBeGreaterThan(0)
  })

  it('renders progress bar', async () => {
    render(<App />)
    await screen.findAllByText('Romeopro')
    expect(document.querySelector('.marathon-progress')).toBeInTheDocument()
  })

  it('renders links section in sidebar', async () => {
    render(<App />)
    expect(await screen.findByText('🔗 Ссылки')).toBeInTheDocument()
    expect(screen.getByText('→ Тема на GipsyTeam')).toBeInTheDocument()
  })
})
