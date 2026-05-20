import { useState, useEffect, useRef, memo } from 'react'

// Smoothly tween the displayed number from its previous value to a new target
// whenever `target` changes. Unlike useAnimatedCounter this does NOT reset to 0
// — it remembers what was on screen and eases from there. Useful for values
// that change in response to user interaction (e.g. filter toggles).
export function useTweenValue(target, duration = 650) {
  const [val, setVal] = useState(target || 0)
  const fromRef = useRef(target || 0)
  useEffect(() => {
    if (target == null) return
    if (duration <= 0) {
      fromRef.current = target
      setVal(target)
      return
    }
    const from = fromRef.current
    if (from === target) { setVal(target); return }
    const start = Date.now()
    let raf
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration)
      const ease = 1 - Math.pow(1 - p, 3)
      const v = from + (target - from) * ease
      setVal(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function useAnimatedCounter(target, duration = 1100) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!target) return
    const start = Date.now()
    let raf
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration)
      const ease = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(ease * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

// Replay a sequence of waypoints (e.g. real BR trajectory through the marathon)
// with an ease-out over the whole duration.
function useAnimatedPath(path, duration) {
  const [val, setVal] = useState(() => path?.[0] ?? 0)
  const pathKey = path ? `${path.length}:${path[path.length - 1]}` : ''
  useEffect(() => {
    if (!path || path.length < 2) {
      if (path?.length) setVal(path[path.length - 1])
      return
    }
    const start = Date.now()
    const segCount = path.length - 1
    let raf
    const tick = () => {
      const elapsed = Date.now() - start
      const p = Math.min(1, elapsed / duration)
      const ease = 1 - Math.pow(1 - p, 3)
      const segPos = ease * segCount
      const segIdx = Math.min(segCount - 1, Math.floor(segPos))
      const segFrac = segPos - segIdx
      const v = path[segIdx] + (path[segIdx + 1] - path[segIdx]) * segFrac
      setVal(Math.round(v))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pathKey, duration])
  return val
}

// Isolated component: 60fps setState only re-renders this <span>, not the whole App.
// Props:
//   target  — final value (used when no path provided)
//   path    — optional array of waypoints to replay; animates through each segment in order
//   format  — (v) => string
//   render  — optional (v) => ReactNode; overrides `format` for dynamic styling
const AnimatedValue = memo(function AnimatedValue({ target, path, format, duration, render }) {
  const simpleVal = useAnimatedCounter(path ? 0 : target, duration ?? 1100)
  const pathVal = useAnimatedPath(path, duration ?? 2200)
  const val = (path ? pathVal : simpleVal) || target || 0
  if (render) return <>{render(val)}</>
  return <>{format(val)}</>
})

export default AnimatedValue
