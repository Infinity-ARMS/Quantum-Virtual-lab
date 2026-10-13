import { MeasurementControls, MeasurementTable, type MeasurementResult } from '../MeasurementPanel'

interface Props {
  labels: readonly string[]
  measured: number[] | null
  measurement: MeasurementResult | null
  shots: number
  onShots: (n: number) => void
  onRun: () => void
  disabled: boolean
}

/** Shot controls and the counts table, in their own row below the kit like the kit's MEASUREMENT section. */
export function MeasurementSection({ labels, measured, measurement, shots, onShots, onRun, disabled }: Props) {
  return (
    <section className="panel measure-panel" aria-label="Measurement">
      <header className="panel-head compact">
        <span className="micro-label strong">Measurement</span>
      </header>
      <div className="measure-body">
        <MeasurementControls shots={shots} onShots={onShots} onRun={onRun} disabled={disabled} />
        <MeasurementTable labels={labels} result={measured ? measurement : null} />
      </div>
    </section>
  )
}
