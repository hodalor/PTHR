import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

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
    return originalFetch(input, init);
  }
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const isLocalhost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(String(window.location?.hostname || '').trim().toLowerCase());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (process.env.NODE_ENV === 'production' && !isLocalhost) {
      navigator.serviceWorker.register(`${process.env.PUBLIC_URL || ''}/sw.js`).catch(() => {});
      return;
    }

    // Dev localhost should not keep an old service worker around because it can
    // intercept CRA hot-reload requests and make the page look like it is stuck refreshing.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {});
      });
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
          caches.delete(key).catch(() => {});
        });
      });
    }
  });
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
