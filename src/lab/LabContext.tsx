import { createContext, useContext } from 'react'

export interface LabContextValue {
  register: (id: string, el: HTMLElement | null) => void
  onSocketPointerDown: (id: string, e: React.PointerEvent) => void
  /** Keyboard activation (Enter / Space) — same as a tap. */
  onSocketKey: (id: string) => void
  selected: string | null
  connected: Set<string>
  live: Set<string>
  rejected: string | null
}

export const LabContext = createContext<LabContextValue | null>(null)

export function useLab() {
  const ctx = useContext(LabContext)
  if (!ctx) throw new Error('useLab outside LabContext')
  return ctx
}
