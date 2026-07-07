import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionGlobalConfig } from 'framer-motion'
import './index.css'
import App from './App.jsx'

// Test hook: ?static jumps every animation to its final state (used for
// headless UI verification, where hidden tabs freeze animation frames).
if (new URLSearchParams(window.location.search).has('static')) {
  MotionGlobalConfig.skipAnimations = true
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
