import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isLive, makeConn, SOCKETS, tryConnect, type Connection } from './circuit'
import type { LabContextValue } from './LabContext'

export interface Toast {
  id: number
  msg: string
  bad?: boolean
}

function restore(key: string): Connection[] {
  try {
    const raw = sessionStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as Connection[]) : []
    // ignore anything that no longer matches the socket catalogue
    return list.filter((c) => SOCKETS[c.from] && SOCKETS[c.to]).map((c) => ({ ...c, delay: 0 }))
  } catch {
    return []
  }
}

/**
 * Virtual banana-cable wiring for one experiment: drag or click-to-connect terminals, validation,
 * feedback toasts and per-experiment persistence (sessionStorage) so navigating away does not lose work.
 */
export function useLabWiring(storageKey: string, onConnected?: (from: string, to: string) => void) {
  const [conns, setConns] = useState<Connection[]>(() => restore(storageKey))
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<{ from: string; x: number; y: number } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [rejected, setRejected] = useState<string | null>(null)
  const [snapKey, setSnapKey] = useState(0)

  const container = useRef<HTMLDivElement>(null)
  const sockets = useRef(new Map<string, HTMLElement>())
  const drag = useRef<{ id: string; x0: number; y0: number; moved: boolean } | null>(null)
  const latest = useRef({ conns, selected, onConnected })
  latest.current = { conns, selected, onConnected }

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(conns))
    } catch {
      /* storage unavailable: wiring just won't survive navigation */
    }
  }, [conns, storageKey])

  const connected = useMemo(() => new Set(conns.flatMap((c) => [c.from, c.to])), [conns])
  const live = useMemo(
    () => new Set(Object.keys(SOCKETS).filter((id) => ['source', 'out'].includes(SOCKETS[id].kind) && isLive(conns, id))),
    [conns],
  )

  const say = useCallback((msg: string, bad = false) => setToast({ id: Date.now(), msg, bad }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  const connect = useCallback(
    (a: string, b: string) => {
      const r = tryConnect(latest.current.conns, a, b)
      if (!r.ok) {
        setRejected(b)
        setTimeout(() => setRejected(null), 450)
        say(r.msg, true)
        return
      }
      setConns(r.conns)
      say(r.msg)
      const added = r.conns[r.conns.length - 1]
      latest.current.onConnected?.(added.from, added.to)
    },
    [say],
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    setPending(null)
  }, [])

  const relative = (e: { clientX: number; clientY: number }) => {
    const r = container.current?.getBoundingClientRect()
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 }
  }

  /** Tap / click / keyboard activation: first terminal selects, second one connects. */
  const activate = useCallback(
    (id: string, at?: { clientX: number; clientY: number }) => {
      const sel = latest.current.selected
      if (sel && sel !== id) {
        connect(sel, id)
        clearSelection()
      } else if (sel === id) {
        clearSelection()
      } else {
        setSelected(id)
        const el = sockets.current.get(id)
        const r = el?.getBoundingClientRect()
        const p = at ?? (r ? { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : { clientX: 0, clientY: 0 })
        setPending({ from: id, ...relative(p) })
        say(`${SOCKETS[id].label} selected — now choose the terminal to connect`)
      }
    },
    [connect, clearSelection, say],
  )

  const onSocketPointerDown = useCallback((id: string, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { id, x0: e.clientX, y0: e.clientY, moved: false }
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (d) {
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) d.moved = true
        if (d.moved) setPending({ from: d.id, ...relative(e) })
      } else if (latest.current.selected && e.pointerType === 'mouse') {
        setPending({ from: latest.current.selected, ...relative(e) })
      }
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.moved) {
        const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-socket]')
        const target = hit?.dataset.socket
        clearSelection()
        if (target && target !== d.id) connect(d.id, target)
        return
      }
      activate(d.id, e)
    }
    const cancel = () => {
      if (drag.current?.moved) setPending(null)
      drag.current = null
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [connect, activate, clearSelection])

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sockets.current.set(id, el)
    else sockets.current.delete(id)
  }, [])

  const ctx: LabContextValue = useMemo(
    () => ({ register, onSocketPointerDown, onSocketKey: activate, selected, connected, live, rejected }),
    [register, onSocketPointerDown, activate, selected, connected, live, rejected],
  )

  return {
    conns,
    ctx,
    container,
    sockets,
    pending,
    selected,
    live,
    toast,
    snapKey,
    say,
    clearSelection,
    removeWire: (id: string) => setConns((cs) => cs.filter((c) => c.id !== id)),
    clearWires: () => {
      setConns([])
      clearSelection()
      say('All cables unplugged')
    },
    reset: () => {
      setConns([])
      clearSelection()
      setSnapKey((k) => k + 1)
      say('Lab reset — all cables unplugged')
    },
    loadWires: (wires: [string, string][]) => {
      setConns(wires.map(([f, t], i) => makeConn(f, t, i * 0.25)))
      clearSelection()
    },
  }
}
