import { useEffect, useRef } from 'react'

interface ButtonProps {
  label: string
  onPress: () => void
  /** Keep pressing while held (SHOT). */
  repeat?: boolean
  disabled?: boolean
  /** Lit ring: the display is in this button's mode. */
  active?: boolean
}

/** Held SHOT keeps firing, with the kit firmware's timing. */
const REPEAT_DELAY_MS = 600
const REPEAT_EVERY_MS = 120

/** Round black push button, as on the kit. */
export function KitButton({ label, onPress, repeat = false, disabled = false, active = false }: ButtonProps) {
  const press = useRef(onPress)
  press.current = onPress
  const timers = useRef<{ wait?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({})
  const stop = () => {
    clearTimeout(timers.current.wait)
    clearInterval(timers.current.every)
  }
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      className={`hw-btn ${active ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onPointerDown={
        repeat
          ? (e) => {
              if (disabled || e.button !== 0) return
              press.current()
              timers.current.wait = setTimeout(() => {
                timers.current.every = setInterval(() => press.current(), REPEAT_EVERY_MS)
              }, REPEAT_DELAY_MS)
            }
          : undefined
      }
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => {
        // a repeat button already pressed on pointer-down; keyboard activation (detail 0) still works
        if (!repeat || e.detail === 0) press.current()
      }}
    >
      <span className="hw-btn-cap" />
    </button>
  )
}

/** Black rocker power switch: I = on, O = off. */
export function PowerSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Power" className={`hw-rocker ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
      <span className="hw-rocker-body">
        <span>I</span>
        <span>O</span>
      </span>
    </button>
  )
}
