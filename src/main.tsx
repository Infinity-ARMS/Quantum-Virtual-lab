import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './product.css'

// The app has a single light theme; forget the preference earlier versions stored.
try {
  localStorage.removeItem('qlab-theme')
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(<App />)
