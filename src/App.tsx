import { AppRouter } from './app/AppRouter'
import { AuthProviderRoot } from './auth/AuthContext'

export default function App() {
  return (
    <AuthProviderRoot>
      <AppRouter />
    </AuthProviderRoot>
  )
}
