import { AnimatePresence, motion } from 'framer-motion'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { analytics } from '../analytics/analyticsService'
import { authProvider, useAuth } from '../auth/AuthContext'
import { HOME_FOR, type Role } from '../auth/types'
import { BrandMark } from './BrandMark'
import { ErrorBoundary, LoadingScreen } from './ErrorBoundary'
import { initials } from './format'

const STUDENT_NAV = [
  { to: '/student', label: 'Dashboard', end: true },
  { to: '/student/bloch', label: 'Bloch Sphere Lab', end: false },
  { to: '/student/measurement', label: 'Measurement Lab', end: false },
  { to: '/student/qubit-state', label: 'Quantum Qubit State Lab', end: false },
]
const TEACHER_NAV = [{ to: '/teacher', label: 'My Students', end: false }]
const ADMIN_NAV = [
  { to: '/admin', label: 'Student Analytics', end: true },
  { to: '/admin/users', label: 'Users & Roles', end: false },
]
const NAV: Record<Role, { to: string; label: string; end: boolean }[]> = { student: STUDENT_NAV, teacher: TEACHER_NAV, admin: ADMIN_NAV }
const SUBTITLE: Record<Role, string> = { student: 'Virtual Quantum Development Kit', teacher: 'Teacher Console', admin: 'Admin Console' }
/** The line under the name in the profile menu. */
const idLine = (role: Role, userId: string) => (role === 'admin' ? 'Administrator' : role === 'teacher' ? 'Teacher' : `Student ID: ${userId}`)

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function ProfileMenu({ role }: { role: Role }) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // a student's linked teacher (from the server), looked up when the menu is first opened
  const [teacher, setTeacher] = useState<string | null | undefined>(undefined)
  const ref = useOutsideClose(open, () => setOpen(false))
  useEffect(() => {
    if (!open || role !== 'student' || teacher !== undefined) return
    authProvider
      .getProfile()
      .then((p) => setTeacher(p.teacher?.name ?? null))
      .catch(() => undefined)
  }, [open, role, teacher])
  if (!session) return null
  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden>
          {initials(session.displayName)}
        </span>
        <span className="profile-text">
          <span className="profile-name">{session.displayName}</span>
          <span className="profile-id">{idLine(role, session.userId)}</span>
        </span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="menu-pop"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="menu-head">
              <strong>{session.displayName}</strong>
              <span>{role === 'student' ? session.userId : idLine(role, session.userId)}</span>
              {role === 'student' && teacher !== undefined && <span>Teacher: {teacher ?? 'not linked'}</span>}
            </div>
            {role === 'student' && (
              <Link role="menuitem" to="/student/profile" className="menu-item" onClick={() => setOpen(false)}>
                View profile
              </Link>
            )}
            <button
              role="menuitem"
              type="button"
              className="menu-item danger"
              onClick={async () => {
                setOpen(false)
                navigate('/', { replace: true })
                await logout()
              }}
            >
              Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Authenticated layout: compact scientific header, desktop nav, mobile drawer, routed content. */
export function AppShell({ role }: { role: Role }) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const nav = NAV[role]
  const menuBtn = useRef<HTMLButtonElement>(null)
  const drawerEl = useRef<HTMLElement>(null)

  useEffect(() => {
    setDrawer(false)
    if (role === 'student') analytics.trackPageView(location.pathname)
  }, [location.pathname, role])

  // the open mobile menu closes on a tap outside it or on Escape (focus goes back to the menu button)
  useEffect(() => {
    if (!drawer) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!drawerEl.current?.contains(t) && !menuBtn.current?.contains(t)) setDrawer(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDrawer(false)
      menuBtn.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [drawer])

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="shell-header">
        <Link to={HOME_FOR[role]} className="brand" aria-label="Quantum Logic and Measurement Emulator home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title">Quantum Logic and Measurement Emulator</span>
            <span className="brand-sub">{SUBTITLE[role]}</span>
          </span>
        </Link>
        <nav className="shell-nav" aria-label="Primary">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell-right">
          <ProfileMenu role={role} />
          <button
            ref={menuBtn}
            type="button"
            className="icon-btn menu-btn"
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            aria-expanded={drawer}
            aria-controls="mobile-drawer"
            onClick={() => setDrawer((d) => !d)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              {drawer ? (
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {drawer && session && (
          <motion.nav
            ref={drawerEl}
            id="mobile-drawer"
            className="mobile-drawer"
            aria-label="Mobile"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="drawer-profile">
              <span className="avatar" aria-hidden>
                {initials(session.displayName)}
              </span>
              <span>
                <strong>{session.displayName}</strong>
                <span>{idLine(role, session.userId)}</span>
              </span>
            </div>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="drawer-link">
                {n.label}
              </NavLink>
            ))}
            {role === 'student' && (
              <NavLink to="/student/profile" className="drawer-link">
                Profile
              </NavLink>
            )}
            <button
              type="button"
              className="drawer-link danger"
              onClick={async () => {
                navigate('/', { replace: true })
                await logout()
              }}
            >
              Log out
            </button>
          </motion.nav>
        )}
      </AnimatePresence>

      <main id="main" className="shell-main" tabIndex={-1}>
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<LoadingScreen />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
