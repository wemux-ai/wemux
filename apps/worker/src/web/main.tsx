import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkerConsoleApp } from './worker-console-app'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Worker console root element not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <WorkerConsoleApp />
  </StrictMode>,
)
