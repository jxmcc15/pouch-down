import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionGlobalConfig } from 'framer-motion'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Test hook: ?static jumps every animation to its final state (used for
// headless UI verification, where hidden tabs freeze animation frames).
if (new URLSearchParams(window.location.search).has('static')) {
  MotionGlobalConfig.skipAnimations = true
}

// Outermost, so even a crash while loading storage (inside App's provider)
// lands on a screen with a way out instead of a blank page.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
