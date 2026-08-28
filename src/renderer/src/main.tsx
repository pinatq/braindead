import './tauri-bridge' // assigns window.api (Tauri-backed) before <App/> mounts
import { installCrashReporting } from './lib/crashReport'
import ErrorBoundary from './components/ErrorBoundary'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'

// Bez StrictMode: podwójne wywołanie efektów w dev kolidowałoby z cyklem życia
// instancji xterm i <webview> (montaż/dispose).
installCrashReporting() // musi stać przed montowaniem — łapie też błędy pierwszego renderu

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
