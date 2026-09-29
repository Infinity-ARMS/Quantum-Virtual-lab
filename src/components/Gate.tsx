import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { GATE_INFO, type GateName } from '../quantum/gates'

interface Props {
  name: GateName | 'CNOT'
  active: boolean
  accent: 'blue' | 'purple'
  children: React.ReactNode
  className?: string
}

/** Gate body with activation glow and a hover tooltip explaining the operation. */
export function Gate({ name, active, accent, children, className = '' }: Props) {
  const [hover, setHover] = useState(false)
  const info = GATE_INFO[name]
  return (
    <div
      className={`gate accent-${accent} ${active ? 'is-active' : ''} ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      <AnimatePresence>
        {hover && (
          <motion.div
            className="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
          >
            <strong>{info.title}</strong>
            {info.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
