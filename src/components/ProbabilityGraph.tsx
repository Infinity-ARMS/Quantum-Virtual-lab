import { motion } from 'framer-motion'
import { AnimatedNumber } from './AnimatedNumber'

interface Props {
  labels: readonly string[]
  theory: number[] | null
  measured: number[] | null
  accent: 'blue' | 'purple'
}

const TICKS = [100, 75, 50, 25, 0]
const ease = [0.4, 0, 0.2, 1] as const

/** Scientific-style bar chart: theoretical |amplitude|² with optional measured frequencies alongside. */
export function ProbabilityGraph({ labels, theory, measured, accent }: Props) {
  const probs = theory ?? labels.map(() => 0)
  // four paired bars leave little room: use whole-percent labels
  const tight = labels.length > 2 && measured !== null
  const digits = tight ? 0 : 1
  return (
    <div className={`prob-chart accent-${accent} ${theory ? '' : 'is-idle'} ${tight ? 'is-tight' : ''}`}>
      <div className="prob-axis">
        {TICKS.map((t) => (
          <span key={t} style={{ bottom: `${t}%` }}>
            {t}%
          </span>
        ))}
      </div>
      <div className="prob-plot">
        {TICKS.map((t) => (
          <div key={t} className={`prob-grid ${t === 50 ? 'is-mid' : ''}`} style={{ bottom: `${t}%` }} />
        ))}
        <div className="prob-bars" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
          {labels.map((label, i) => {
            const p = probs[i]
            const m = measured?.[i]
            return (
              <div key={label} className="prob-slot">
                <div className="prob-pair">
                  <div className="prob-bar-track">
                    <motion.div
                      className="prob-bar theory"
                      initial={false}
                      animate={{ height: `${p * 100}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                    <motion.span
                      className="prob-value"
                      initial={false}
                      animate={{ bottom: `${p * 100}%` }}
                      transition={{ duration: 0.6, ease }}
                    >
                      <AnimatedNumber value={p * 100} digits={digits} suffix="%" />
                    </motion.span>
                  </div>
                  {m !== undefined && (
                    <div className="prob-bar-track measured-track">
                      <motion.div
                        className="prob-bar measured"
                        initial={{ height: 0 }}
                        animate={{ height: `${m * 100}%` }}
                        transition={{ duration: 0.6, ease }}
                      />
                      <motion.span
                        className="prob-value measured-value"
                        initial={{ bottom: 0 }}
                        animate={{ bottom: `${m * 100}%` }}
                        transition={{ duration: 0.6, ease }}
                      >
                        <AnimatedNumber value={m * 100} digits={digits} suffix="%" />
                      </motion.span>
                    </div>
                  )}
                </div>
                <div className="prob-label">{label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
