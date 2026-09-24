
import './utils/domPolyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './hooks/useToast';

// Automatically reload the page if a dynamically imported module fails to load.
// This typically happens when the user has an old version of the app open and
// we push an OTA update, causing the old chunk hashes to become invalid.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

// We also add a generic unhandledrejection listener just in case a regular dynamic import() fails
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message && event.reason.message.includes('Failed to fetch dynamically imported module')) {
    window.location.reload();
  }
});

// Suppress third-party Chrome extension script crashes (e.g. reportAllChanges / startTime on undefined entries)
window.addEventListener('error', (event) => {
  if (
    event.message &&
    (event.message.includes('reportAllChanges') ||
      (event.message.includes('startTime') && (event.filename?.includes('VM') || !event.filename)))
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);


import { HelmetProvider } from 'react-helmet-async';
import { ThemeProvider } from './contexts/ThemeContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const appContent = (
  <React.StrictMode>
    <HelmetProvider>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </HelmetProvider>
  </React.StrictMode>
);

if (rootElement.hasChildNodes()) {
  ReactDOM.hydrateRoot(rootElement, appContent);
} else {
  const root = ReactDOM.createRoot(rootElement);
  root.render(appContent);
}

if ('serviceWorker' in navigator && typeof window !== 'undefined') {
  // Register service worker immediately to speed up PWA installation readiness and check for updates
  navigator.serviceWorker.register('/service-worker.js')
    .then((reg) => {
      console.log('Service Worker registered successfully:', reg.scope);
      // Eagerly check for updated service worker script on app launch
      void reg.update().catch(() => {});
    })
    .catch((err) => console.warn('Service Worker registration failed:', err));
}

