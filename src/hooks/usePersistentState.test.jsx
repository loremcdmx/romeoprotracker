import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { usePersistentState } from './usePersistentState.js'

function createMemoryStorage(initial = {}) {
  const store = { ...initial }
  return {
    store,
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => {
      store[key] = String(value)
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
  }
}

function NumberProbe({ storage, initialValue = 1, options = {} }) {
  const [value, setValue] = usePersistentState('probe', initialValue, { storage, ...options })

  return (
    <div>
      <output data-testid="value">{String(value)}</output>
      <button onClick={() => setValue((prev) => prev + 1)}>increment</button>
    </div>
  )
}

function SetProbe({ storage }) {
  const [value, setValue] = usePersistentState('probe', new Set(['aa']), {
    storage,
    serialize: (next) => JSON.stringify([...next]),
    deserialize: (raw) => new Set(JSON.parse(raw)),
  })

  return (
    <div>
      <output data-testid="value">{[...value].join(',')}</output>
      <button onClick={() => setValue((prev) => new Set([...prev, 'cc']))}>add</button>
    </div>
  )
}

describe('usePersistentState', () => {
  it('hydrates from storage and persists updater-function writes', () => {
    const storage = createMemoryStorage({ probe: '7' })

    render(<NumberProbe storage={storage} />)

    expect(screen.getByTestId('value')).toHaveTextContent('7')

    fireEvent.click(screen.getByText('increment'))

    expect(screen.getByTestId('value')).toHaveTextContent('8')
    expect(storage.setItem).toHaveBeenLastCalledWith('probe', '8')
    expect(storage.store.probe).toBe('8')
  })

  it('supports custom serialization and deserialization', () => {
    const storage = createMemoryStorage({ probe: '["aa","bb"]' })

    render(<SetProbe storage={storage} />)

    expect(screen.getByTestId('value')).toHaveTextContent('aa,bb')

    fireEvent.click(screen.getByText('add'))

    expect(screen.getByTestId('value')).toHaveTextContent('aa,bb,cc')
    expect(storage.store.probe).toBe('["aa","bb","cc"]')
  })

  it('falls back to the initial value when storage is malformed', () => {
    const storage = createMemoryStorage({ probe: '{broken json' })

    render(<NumberProbe storage={storage} initialValue={5} />)

    expect(screen.getByTestId('value')).toHaveTextContent('5')
  })

  it('falls back to the initial value when custom deserialization throws', () => {
    const storage = createMemoryStorage({ probe: 'raw-value' })

    render(<NumberProbe storage={storage} initialValue={9} options={{
      deserialize: () => {
        throw new Error('bad value')
      },
    }} />)

    expect(screen.getByTestId('value')).toHaveTextContent('9')
  })

  it('keeps UI state working even when setItem throws', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded')
      }),
    }

    render(<NumberProbe storage={storage} initialValue={1} />)
    fireEvent.click(screen.getByText('increment'))

    expect(screen.getByTestId('value')).toHaveTextContent('2')
  })
})
