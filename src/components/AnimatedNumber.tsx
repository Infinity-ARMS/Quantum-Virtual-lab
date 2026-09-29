import { animate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/** Number that tweens smoothly to its new value. */
export function AnimatedNumber({ value, digits = 1, suffix = '' }: { value: number; digits?: number; suffix?: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const ctrl = animate(from.current, value, {
      duration: 0.6,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (v) => {
        from.current = v
        setShown(v)
      },
    })
    return () => ctrl.stop()
  }, [value])
  return (
    <>
      {shown.toFixed(digits)}
      {suffix}
    </>
  )
}
