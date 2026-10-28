import { useLayoutEffect, useState } from 'react'

/** Phone layouts (the same media queries as in kit.css): the whole kit on one screen, without scrolling. */
export const PHONE_PORTRAIT = '(max-width: 600px) and (orientation: portrait)'
export const PHONE_LANDSCAPE = '(max-width: 1000px) and (max-height: 500px) and (orientation: landscape)'

/** The smallest panel (CSS px) a lab needs in each phone layout; on a smaller screen the panel is scaled down to fit. */
export type KitMinSize = Record<'portrait' | 'landscape', { w: number; h: number }>

/**
 * On phones: the page below the header is exactly the window's height (nothing to scroll) and the panel is drawn at
 * `w × h` and scaled by `s` (≤ 1) to fill it. Returns null elsewhere — the normal responsive layout applies.
 * `min` must be a constant (it is an effect dependency).
 */
export function useKitFit(page: React.RefObject<HTMLDivElement | null>, min: KitMinSize) {
  const [fit, setFit] = useState<{ pageH: number; w: number; h: number; s: number } | null>(null)
  useLayoutEffect(() => {
    const update = () => {
      const el = page.current
      const mode = matchMedia(PHONE_PORTRAIT).matches ? 'portrait' : matchMedia(PHONE_LANDSCAPE).matches ? 'landscape' : null
      if (!el || !mode) return setFit(null)
      const cs = getComputedStyle(el)
      const pageH = Math.max(0, Math.floor(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY)))
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const h = pageH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      const s = Math.min(1, w / min[mode].w, h / min[mode].h)
      const next = { pageH, w: Math.floor(w / s), h: Math.floor(h / s), s }
      setFit((f) => (f && f.pageH === next.pageH && f.w === next.w && f.h === next.h && f.s === next.s ? f : next))
    }
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [page, min])
  return fit
}
