import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { preloadManifold } from './lib/manifoldOps'

// Warm Manifold WASM so the first preview/export isn't blocked on download
void preloadManifold()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
