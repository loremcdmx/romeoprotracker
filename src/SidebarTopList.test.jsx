import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SidebarTopList } from './App.jsx'

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

function mockRect(node, rect) {
  Object.defineProperty(node, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
}

function makePosts() {
  return [
    {
      author: 'Alpha',
      text: 'Alpha preview text',
      likes: 25,
      timestamp: 1712500000,
      images: [],
      url: 'https://forum.gipsyteam.ru/test-alpha',
    },
    {
      author: 'Beta',
      text: 'Beta preview text',
      likes: 18,
      timestamp: 1712503600,
      images: [],
      url: 'https://forum.gipsyteam.ru/test-beta',
    },
  ]
}

describe('SidebarTopList', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true })
  })

  it('opens the correct popup from wrapper mouse movement even if row mouseenter is missed', async () => {
    render(<SidebarTopList posts={makePosts()} setLightbox={vi.fn()} />)

    const firstRow = screen.getByTestId('sidebar-top-item-0')
    const secondRow = screen.getByTestId('sidebar-top-item-1')
    const wrapper = firstRow.parentElement

    mockRect(firstRow, { left: 1080, right: 1380, top: 100, bottom: 148, width: 300, height: 48 })
    mockRect(secondRow, { left: 1080, right: 1380, top: 148, bottom: 196, width: 300, height: 48 })

    fireEvent.mouseMove(wrapper, { clientX: 1210, clientY: 172 })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-top-popup')).toHaveTextContent('Beta')
    })
  })

  it('switches the popup while moving through the popup corridor between rows', async () => {
    render(<SidebarTopList posts={makePosts()} setLightbox={vi.fn()} />)

    const firstRow = screen.getByTestId('sidebar-top-item-0')
    const secondRow = screen.getByTestId('sidebar-top-item-1')

    mockRect(firstRow, { left: 1080, right: 1380, top: 100, bottom: 148, width: 300, height: 48 })
    mockRect(secondRow, { left: 1080, right: 1380, top: 148, bottom: 196, width: 300, height: 48 })

    fireEvent.mouseEnter(firstRow)

    const popup = await screen.findByTestId('sidebar-top-popup')
    mockRect(popup, { left: 720, right: 1060, top: 88, bottom: 260, width: 340, height: 172 })

    fireEvent.mouseMove(popup, { clientX: 860, clientY: 172 })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-top-popup')).toHaveTextContent('Beta')
    })
  })
})
