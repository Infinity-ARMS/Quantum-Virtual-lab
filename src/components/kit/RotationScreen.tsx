import type { RotationReadout } from '../../quantum/rotation'
import { StateSphere } from '../StateSphere'
import { TftBoot } from './KitScreen'

interface Props {
  booting: boolean
  theta: number
  phi: number
  readout: RotationReadout
  chip: string
  footer: { text: string; tone: 'hint' | 'info' | 'warn' }
}

/** Two decimals, with a true minus sign and no "−0.00". */
const fix = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace('-', '−')

/**
 * The Quantum Qubit State Lab's TFT, laid out like the kit's "QUANTUM ROTATION" screen: the Bloch sphere with the state set
 * by the two knobs, and beside it the point P(θ, φ), both angles, P(|0⟩), P(|1⟩) and the state itself, all live.
 */
export function RotationScreen({ booting, theta, phi, readout: r, chip, footer }: Props) {
  if (booting) return <TftBoot />
  return (
    <div className="tft-ui">
      <header className="tft-head">
        <span className="tft-mode">Quantum Rotation</span>
        <span className="tft-chip">{chip}</span>
        <span className="tft-phase ok">
          <i aria-hidden />
          Live output
        </span>
      </header>
      <div className="tft-body">
        <div className="tft-rot">
          <div className="tft-rot-sphere">
            <StateSphere theta={theta} phi={phi} />
          </div>
          <div className="tft-rot-calc" aria-label="Calculations">
            <p className="rc-title">
              P(θ, φ) <span>= P({theta}°, {phi}°)</span>
            </p>
            <div className="rc-angles">
              <div className="rc-angle theta">
                <span>
                  θ polar<small> · pot 1</small>
                </span>
                <b>{theta}°</b>
              </div>
              <div className="rc-angle phi">
                <span>
                  φ azimuth<small> · pot 2</small>
                </span>
                <b>{phi}°</b>
              </div>
            </div>
            <div className="rc-probs">
              {(
                [
                  ['|0⟩', 'cos²(θ/2)', r.p0, 'zero'],
                  ['|1⟩', 'sin²(θ/2)', r.p1, 'one'],
                ] as const
              ).map(([ket, rule, p, cls]) => (
                <div key={ket} className={`rc-prob ${cls}`}>
                  <span>
                    P({ket}) <em>= {rule}</em>
                  </span>
                  <b>{p.toFixed(2)}</b>
                  <i aria-hidden>
                    <s style={{ width: `${p * 100}%` }} />
                  </i>
                </div>
              ))}
            </div>
            <div className="rc-state">
              <span className="rc-formula">
                |ψ⟩ = cos(θ/2)|0⟩ + e<sup>iφ</sup> sin(θ/2)|1⟩
              </span>
              <span className="rc-ket">= {r.ket.replace(/-/g, '−')}</span>
            </div>
            <p className="rc-bloch">
              (x, y, z) = ({fix(r.bloch[0])}, {fix(r.bloch[1])}, {fix(r.bloch[2])})
            </p>
          </div>
        </div>
      </div>
      <footer className={`tft-foot ${footer.tone}`} aria-live="polite">
        {footer.text}
      </footer>
    </div>
  )
}
