import { SOCKETS, type Connection, type VizSignal } from '../../lab/circuit'
import { Socket } from '../Socket'

interface Props {
  target: 'graph' | 'bloch'
  name: string
  conns: Connection[]
  ports: { id: 'q0' | 'q1'; signal: VizSignal | null }[]
}

/** Labelled input terminals along the bottom edge of a visualization panel. */
export function VizInputs({ target, name, conns, ports }: Props) {
  return (
    <footer className={`viz-foot ports-${ports.length}`}>
      {ports.map(({ id: q, signal }) => {
        const id = `viz.${target}.${q}`
        const cable = conns.find((c) => c.to === id)
        const state = cable ? (signal ? 'connected' : 'waiting') : 'open'
        return (
          <div key={q} className={`viz-input is-${state}`}>
            <Socket id={id} size="lg" />
            <div className="viz-input-text">
              <span className="viz-input-name">
                {name} <b>{q.toUpperCase()}</b>
              </span>
              <span className="viz-input-status" role="status">
                <i className="dot" aria-hidden />
                {state === 'connected'
                  ? `Connected · ${SOCKETS[cable!.from].label}`
                  : state === 'waiting'
                    ? 'Cable in · no signal yet'
                    : 'Open · not connected'}
              </span>
            </div>
          </div>
        )
      })}
    </footer>
  )
}
