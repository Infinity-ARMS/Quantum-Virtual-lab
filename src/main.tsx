import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './product.css'

// Apply a saved theme before first paint to avoid a light→dark flash
try {
  if (localStorage.getItem('qlab-theme') === 'dark') document.documentElement.classList.add('dark')
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(<App />)
