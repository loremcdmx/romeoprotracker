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

// Isolated component: 60fps setState only re-renders this <span>, not the whole App
const AnimatedValue = memo(function AnimatedValue({ target, format, duration }) {
  const val = useAnimatedCounter(target, duration)
  return <>{format(val || target)}</>
})

export default AnimatedValue
