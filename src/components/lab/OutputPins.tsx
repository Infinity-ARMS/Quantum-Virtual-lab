import type { Connection, VizSignal } from '../../lab/circuit'
import { VizInputs } from './VizInputs'

interface Props {
  target: 'graph' | 'bloch'
  name: string
  conns: Connection[]
  ports: { id: 'q0' | 'q1'; signal: VizSignal | null }[]
}

/** The visualization's input terminals, placed beside the display like the kit's output banana pins. */
export function OutputPins(props: Props) {
  return (
    <section className="panel out-panel" aria-label="Output pins">
      <header className="panel-head compact">
        <span className="micro-label strong">Output Pins</span>
      </header>
      <VizInputs {...props} />
    </section>
  )
}
