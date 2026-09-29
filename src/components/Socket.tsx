import { useCallback } from 'react'
import { SOCKETS } from '../lab/circuit'
import { useLab } from '../lab/LabContext'

interface Props {
  id: string
  label?: React.ReactNode
  labelSide?: 'left' | 'right' | 'top' | 'bottom'
  size?: 'md' | 'lg'
}

/**
 * A banana-pin terminal. Drag from it to another terminal, or tap/click (or Enter/Space) one terminal and then
 * another. The button is a comfortable touch target; the visible terminal sits centred inside it.
 */
export function Socket({ id, label, labelSide = 'right', size = 'md' }: Props) {
  const { register, onSocketPointerDown, onSocketKey, selected, connected, live, rejected } = useLab()
  const meta = SOCKETS[id]
  const ref = useCallback((el: HTMLElement | null) => register(id, el), [id, register])
  const isConnected = connected.has(id)
  const cls = [
    'socket',
    `tone-${meta.tone}`,
    `size-${size}`,
    selected === id && 'is-selected',
    isConnected && 'is-connected',
    isConnected && live.has(id) && 'is-live',
    rejected === id && 'is-rejected',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`socket-wrap label-${labelSide}`}>
      <button
        type="button"
        ref={ref}
        className={`socket-hit size-${size}`}
        data-socket={id}
        aria-label={`${meta.label} terminal, ${isConnected ? 'connected' : 'not connected'}${selected === id ? ', selected' : ''}`}
        aria-pressed={selected === id}
        title={`${meta.label} — drag, or tap then tap another terminal`}
        onPointerDown={(e) => onSocketPointerDown(id, e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSocketKey(id)
          }
        }}
      >
        <span className={cls}>
          <span className="socket-collar">
            <span className="socket-hole" />
          </span>
        </span>
      </button>
      {label && <span className="socket-label">{label}</span>}
    </div>
  )
}
