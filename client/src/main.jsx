import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { store } from './app/store.js';
import { App } from './App.jsx';
import { QueryClientProvider } from '@tanstack/react-query';
import { opsQueryClient, clearOpsCacheOnUserChange } from './lib/opsQueryClient.js';
import './styles/globals.css';
import './styles/new-project-modal.css';
import './styles/site-evaluation-overview.css';
import './styles/report-watermark.css';
import './styles/form-unit-group.css';
import './styles/toast.css';
import './styles/guide.css';
import './styles/journey.css';
import './styles/vendor-master.css';
// The inventory master and the IMS share one visual language; inventory.css
// declares it and ims.css extends it, so the order below matters.
import './styles/inventory.css';
// The IMS reuses inventory.css's furniture, so it must load after it.
import './styles/ims.css';
// ERS reuses the inventory page shell (scroll contract, single-line filters).
import './styles/ers.css';
import './styles/property-capture.css';
/* Must follow property-capture.css — the Design & Drawings FMS layers a few
   overrides on the Property system it borrows. */
import './styles/design-drawings.css';
// Delegation, Checklist and Organisation screens.
import './styles/ops.css';

// Apply persisted theme before first paint.
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem('mr-erp-theme') || 'light',
);

clearOpsCacheOnUserChange(store);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ReduxProvider store={store}>
      <QueryClientProvider client={opsQueryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ReduxProvider>
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
