import { useState, useEffect, memo } from 'react'

function useAnimatedCounter(target, duration = 1100) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!target) return
    const start = Date.now()
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration)
      const ease = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(ease * target))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
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
    const tick = () => {
      const elapsed = Date.now() - start
      const p = Math.min(1, elapsed / duration)
      const ease = 1 - Math.pow(1 - p, 3)
      const segPos = ease * segCount
      const segIdx = Math.min(segCount - 1, Math.floor(segPos))
      const segFrac = segPos - segIdx
      const v = path[segIdx] + (path[segIdx + 1] - path[segIdx]) * segFrac
      setVal(Math.round(v))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
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
