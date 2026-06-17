import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'

// Bez StrictMode: podwójne wywołanie efektów w dev kolidowałoby z cyklem życia
// instancji xterm i <webview> (montaż/dispose).
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
