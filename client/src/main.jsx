import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient.js';
import { App } from './App.jsx';
import './styles/globals.css';

// Apply persisted theme before first paint.
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem('mr-erp-theme') || 'light',
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

// Dismiss the first-load brand splash once the app has mounted (min ~1.1s so
// the logo reads as a deliberate launch moment, not a flash).
(function dismissSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  const start = performance.now();
  const MIN_MS = 1100;
  const hide = () => {
    const wait = Math.max(0, MIN_MS - (performance.now() - start));
    setTimeout(() => {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 600);
    }, wait);
  };
  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide, { once: true });
})();
