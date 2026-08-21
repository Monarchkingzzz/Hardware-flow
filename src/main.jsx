import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register Service Worker for Progressive Web App (PWA) functionality
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        console.log('[HardwareFlow PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch(err => {
        console.warn('[HardwareFlow PWA] Service Worker registration failed:', err);
      });
  });
}

