import { lazy } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import LandingPage from '../pages/public/LandingPage'
import LoginPage from '../pages/public/LoginPage'
import StudentDashboard from '../pages/student/StudentDashboard'
import { AppShell } from './AppShell'
import { RequireRole } from './guards'

// Three.js and the lab only load when an experiment opens; admin pages load for admins only
const BlochLabPage = lazy(() => import('../pages/student/BlochLabPage'))
const MeasurementLabPage = lazy(() => import('../pages/student/MeasurementLabPage'))
const ProfilePage = lazy(() => import('../pages/student/ProfilePage'))
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'))
const AdminStudentDetail = lazy(() => import('../pages/admin/AdminStudentDetail'))
const AdminUsers = lazy(() => import('../pages/admin/AdminUsers'))

function NotFound() {
  return (
    <div className="state-screen">
      <div className="state-card">
        <h2>Page not found</h2>
        <p>That address doesn&apos;t match any part of the lab.</p>
        <div className="state-actions">
          <Link className="btn btn-primary" to="/">
            Go to start
          </Link>
        </div>
      </div>
    </div>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* one sign-in page for everyone; older addresses lead to it */}
        <Route path="/register" element={<Navigate to="/login?mode=create" replace />} />
        <Route path="/student/login" element={<Navigate to="/login" replace />} />
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />

        <Route
          path="/student"
          element={
            <RequireRole role="student">
              <AppShell role="student" />
            </RequireRole>
          }
        >
          <Route index element={<StudentDashboard />} />
          <Route path="profile" element={<ProfilePage />} />
          {/* each lab opens straight onto its kit with all of its gates; old per-gate addresses lead there */}
          <Route path="bloch" element={<BlochLabPage />} />
          <Route path="bloch/:gate" element={<Navigate to="/student/bloch" replace />} />
          <Route path="measurement" element={<MeasurementLabPage />} />
          <Route path="measurement/:kind" element={<Navigate to="/student/measurement" replace />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <AppShell role="admin" />
            </RequireRole>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="students/:id" element={<AdminStudentDetail />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
