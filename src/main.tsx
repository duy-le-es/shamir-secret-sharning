import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'
import './styles.css'

// Full page load / reload always lands on Members (demo entry point).
if (window.location.pathname !== '/members') {
  window.history.replaceState(null, '', '/members')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
