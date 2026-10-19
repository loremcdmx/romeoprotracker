import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('does not write on mount, and inline serializers do not retrigger a write on re-render', () => {
    const storage = createMemoryStorage({ probe: '["aa"]' })
    const Probe = ({ tick }) => {
      const [value] = usePersistentState('probe', new Set(), {
        storage,
        // Fresh arrows on every render, like the inline ones in App.
        serialize: (next) => JSON.stringify([...next]),
        deserialize: (raw) => new Set(JSON.parse(raw)),
      })
      return <output data-testid="value">{[...value].join(',')}:{tick}</output>
    }

    const { rerender } = render(<Probe tick={0} />)
    rerender(<Probe tick={1} />)
    rerender(<Probe tick={2} />)

    expect(screen.getByTestId('value')).toHaveTextContent('aa:2')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('replaces an unsupported stored value once on mount, and leaves valid values alone', () => {
    const options = (storage) => ({
      storage,
      serialize: String,
      deserialize: (raw) => (['a', 'b'].includes(raw) ? raw : 'a'),
    })
    function ChoiceProbe({ storage }) {
      const [value] = usePersistentState('choice', 'a', options(storage))
      return <output data-testid="value">{value}</output>
    }

    const bad = createMemoryStorage({ choice: 'bogus' })
    render(<ChoiceProbe storage={bad} />)
    expect(screen.getByTestId('value')).toHaveTextContent('a')
    expect(bad.store.choice).toBe('a')

    const good = createMemoryStorage({ choice: 'b' })
    render(<ChoiceProbe storage={good} />)
    expect(good.setItem).not.toHaveBeenCalled()

    const empty = createMemoryStorage()
    render(<ChoiceProbe storage={empty} />)
    expect(empty.setItem).not.toHaveBeenCalled()
  })

  it('persists exactly once per change under StrictMode double rendering', () => {
    const storage = createMemoryStorage({ probe: '7' })

    render(<StrictMode><NumberProbe storage={storage} /></StrictMode>)
    expect(storage.setItem).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('increment'))
    fireEvent.click(screen.getByText('increment'))

    expect(screen.getByTestId('value')).toHaveTextContent('9')
    expect(storage.setItem.mock.calls).toEqual([['probe', '8'], ['probe', '9']])
  })

  it('renders with in-memory state when reading window.localStorage throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
    })
    try {
      render(<NumberProbe initialValue={4} storage={undefined} />)
      expect(screen.getByTestId('value')).toHaveTextContent('4')
      fireEvent.click(screen.getByText('increment'))
      expect(screen.getByTestId('value')).toHaveTextContent('5')
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  describe('two tabs sharing one storage', () => {
    // Two hook instances on one storage stand in for two tabs: browsers only
    // fire `storage` events in the OTHER tabs, so the test dispatches them.
    function FavProbe({ storage, name }) {
      const [value, setValue] = usePersistentState('fav', new Set(), {
        storage,
        serialize: (next) => JSON.stringify([...next]),
        deserialize: (raw) => new Set(JSON.parse(raw)),
      })
      return (
        <div>
          <output data-testid={`${name}-value`}>{[...value].join(',')}</output>
          <button onClick={() => setValue((prev) => new Set([...prev, name]))}>{`${name}-add`}</button>
          <button onClick={() => setValue(new Set())}>{`${name}-clear`}</button>
        </div>
      )
    }

    // jsdom only accepts a real Storage as `storageArea`, so the mock storage
    // is not attached; the hook accepts events that do not name an area.
    function storageEvent(storage, key, newValue) {
      return new StorageEvent('storage', { key, newValue })
    }

    it('a background tab re-renders without overwriting what the other tab saved', () => {
      const storage = createMemoryStorage()
      const Tabs = ({ tick }) => (
        <>
          <FavProbe storage={storage} name="a" />
          <FavProbe storage={storage} name="b" />
          <output data-testid="tick">{tick}</output>
        </>
      )
      const { rerender } = render(<Tabs tick={0} />)

      fireEvent.click(screen.getByText('a-add'))
      expect(storage.store.fav).toBe('["a"]')
      // Tab b renders again (new data, a click) while still holding its old
      // empty state and never having changed anything itself.
      rerender(<Tabs tick={1} />)
      rerender(<Tabs tick={2} />)

      expect(storage.store.fav).toBe('["a"]')
      expect(storage.setItem).toHaveBeenCalledTimes(1)
    })

    it('re-hydrates from the storage event instead of keeping the stale value', () => {
      const storage = createMemoryStorage()
      render(<FavProbe storage={storage} name="b" />)
      expect(screen.getByTestId('b-value')).toHaveTextContent('')

      // The other tab saves a favourite.
      storage.store.fav = '["x","y"]'
      act(() => { window.dispatchEvent(storageEvent(storage, 'fav', '["x","y"]')) })
      expect(screen.getByTestId('b-value')).toHaveTextContent('x,y')

      // Its next edit builds on the other tab's data.
      fireEvent.click(screen.getByText('b-add'))
      expect(storage.store.fav).toBe('["x","y","b"]')
    })

    it('applies an edit to what is stored even when the storage event was missed', () => {
      const storage = createMemoryStorage()
      render(<FavProbe storage={storage} name="b" />)

      storage.store.fav = '["x"]'
      fireEvent.click(screen.getByText('b-add'))

      expect(storage.store.fav).toBe('["x","b"]')
      expect(screen.getByTestId('b-value')).toHaveTextContent('x,b')
    })

    it('resets to the initial value when the other tab clears the key', () => {
      const storage = createMemoryStorage({ fav: '["x"]' })
      render(<FavProbe storage={storage} name="b" />)
      expect(screen.getByTestId('b-value')).toHaveTextContent('x')

      delete storage.store.fav
      act(() => { window.dispatchEvent(storageEvent(storage, 'fav', null)) })
      expect(screen.getByTestId('b-value')).toHaveTextContent('')

      storage.store.fav = '["z"]'
      act(() => { window.dispatchEvent(storageEvent(storage, null, null)) })
      expect(screen.getByTestId('b-value')).toHaveTextContent('z')
    })

    it('ignores events for other keys and falls back when the new value is malformed', () => {
      const storage = createMemoryStorage({ fav: '["x"]', other: '1' })
      render(<FavProbe storage={storage} name="b" />)

      storage.store.other = '2'
      act(() => { window.dispatchEvent(storageEvent(storage, 'other', '2')) })
      expect(screen.getByTestId('b-value')).toHaveTextContent('x')

      storage.store.fav = '{broken'
      act(() => { window.dispatchEvent(storageEvent(storage, 'fav', '{broken')) })
      expect(screen.getByTestId('b-value')).toHaveTextContent('')
    })

    it('keeps its own value when a write fails instead of reverting to what storage holds', () => {
      const storage = createMemoryStorage({ probe: '1' })
      storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })

      render(<NumberProbe storage={storage} />)
      fireEvent.click(screen.getByText('increment'))
      fireEvent.click(screen.getByText('increment'))

      expect(screen.getByTestId('value')).toHaveTextContent('3')
    })
  })
})

