import { lazy } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import LandingPage from '../pages/public/LandingPage'
import LoginPage from '../pages/public/LoginPage'
import StudentDashboard from '../pages/student/StudentDashboard'
import { BlochSelectPage, MeasurementSelectPage } from '../pages/student/SelectionPages'
import { AppShell } from './AppShell'
import { RequireRole } from './guards'

// Three.js and the lab only load when an experiment opens; admin pages load for admins only
const BlochExperimentPage = lazy(() => import('../pages/student/BlochExperimentPage'))
const MeasurementExperimentPage = lazy(() => import('../pages/student/MeasurementExperimentPage'))
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
          <Route path="bloch" element={<BlochSelectPage />} />
          <Route path="bloch/:gate" element={<BlochExperimentPage />} />
          <Route path="measurement" element={<MeasurementSelectPage />} />
          <Route path="measurement/:kind" element={<MeasurementExperimentPage />} />
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
