import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTweenValue } from './components/AnimatedValue.jsx'

describe('useTweenValue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] })
  })
  afterEach(() => { vi.useRealTimers() })

  const advance = ms => act(() => { vi.advanceTimersByTime(ms) })

  it('eases to the target and settles on it', () => {
    const { result, rerender } = renderHook(({ target }) => useTweenValue(target, 1000), { initialProps: { target: 0 } })
    rerender({ target: 1000 })
    advance(400)
    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(1000)
    advance(1000)
    expect(result.current).toBe(1000)
  })

  it('retargeted mid-flight, continues from the number on screen instead of the interrupted start', () => {
    const { result, rerender } = renderHook(({ target }) => useTweenValue(target, 1000), { initialProps: { target: 0 } })
    rerender({ target: 1000 })
    advance(500)
    const onScreen = result.current
    expect(onScreen).toBeGreaterThan(500) // ease-out: well past halfway
    expect(onScreen).toBeLessThan(1000)

    rerender({ target: 2000 }) // the user flipped the period again
    advance(20)
    // the old code restarted from 0 here, a visible jump backwards
    expect(result.current).toBeGreaterThanOrEqual(onScreen)
    expect(result.current).toBeLessThan(2000)
    advance(1200)
    expect(result.current).toBe(2000)
  })

  it('chains several retargets without ever jumping back', () => {
    const { result, rerender } = renderHook(({ target }) => useTweenValue(target, 600), { initialProps: { target: 100 } })
    const seen = []
    for (const target of [900, 300, 1500]) {
      rerender({ target })
      advance(200)
      seen.push(result.current)
    }
    // each retarget starts from where the last one was, so the values stay inside the visited range
    expect(seen.every(v => v >= 100 && v <= 1500)).toBe(true)
    advance(1000)
    expect(result.current).toBe(1500)
  })
})
