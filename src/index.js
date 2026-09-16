import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import ErrorBoundary from './components/ErrorBoundary';
import { captureException } from './utils/errorTracking';
import { logger } from './utils/logger';

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  try {
    const rawAuth = window.localStorage.getItem('pthr_auth');
    const auth = rawAuth ? JSON.parse(rawAuth) : null;
    const headers = new Headers(init.headers || {});
    if (auth?.tenantId && !headers.has('X-Tenant-Id')) {
      headers.set('X-Tenant-Id', String(auth.tenantId).trim().toLowerCase());
    }
    if (auth?.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${auth.token}`);
    }
    return await originalFetch(input, {
      ...init,
      headers,
    });
  } catch (error) {
    captureException(error, { source: 'window.fetch-wrapper' });
    return originalFetch(input, init);
  }
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

const isLocalhost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(String(window.location?.hostname || '').trim().toLowerCase());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (process.env.NODE_ENV === 'production' && !isLocalhost) {
      navigator.serviceWorker
        .register(`${process.env.PUBLIC_URL || ''}/sw.js`)
        .catch((error) => captureException(error, { source: 'service-worker-register' }));
      return;
    }

    // Dev localhost should not keep an old service worker around because it can
    // intercept CRA hot-reload requests and make the page look like it is stuck refreshing.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch((error) => captureException(error, { source: 'service-worker-unregister' }));
      });
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
          caches.delete(key).catch((error) => captureException(error, { source: 'cache-delete', key }));
        });
      });
    }
  });
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals((metric) => {
  logger.debug('web-vitals', metric);
});
