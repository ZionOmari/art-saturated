import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'
import { reloadForStaleChunk } from './lib/staleChunk'

// Vite fires this when a lazy page's files can't be fetched — usually because
// a deploy replaced them while this tab was open. Reload instead of erroring.
// The import still rejects; the ErrorBoundary sees a reload in progress and
// shows the page loader instead of an error.
window.addEventListener('vite:preloadError', () => { reloadForStaleChunk() })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
