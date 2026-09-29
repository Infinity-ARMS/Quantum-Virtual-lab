import { AppRouter } from './app/AppRouter'
import { AuthProviderRoot } from './auth/AuthContext'
import { ThemeProvider } from './theme/ThemeContext'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProviderRoot>
        <AppRouter />
      </AuthProviderRoot>
    </ThemeProvider>
  )
}
