
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


declare var __firebase_config: any;

// ... (SetupRequired component stays the same)
const SetupRequired: React.FC = () => (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-2xl text-center bg-white dark:bg-black p-8 rounded-2xl shadow-2xl border border-red-200">
        <img src="/logo_icon.png" alt="AVELUT" className="w-16 h-16 mx-auto mb-4 object-contain" />
        <h1 className="text-3xl font-bold text-red-600">Configuration Required</h1>
        <p className="mt-4 text-lg text-gray-700">
          Welcome to AVELUT! To get started, you need to connect the application to your Firebase project.
        </p>
        <div className="mt-6 text-left bg-gray-50 dark:bg-black p-6 rounded-lg border border-gray-200">
          <p className="font-semibold  dark:text-white">Please follow these steps:</p>
          <ol className="list-decimal list-inside mt-2 space-y-2 text-gray-600">
            <li>Open the <code className="bg-gray-200 text-red-700 font-mono px-1 py-0.5 rounded">index.html</code> file in your project.</li>
            <li>Find the script tag near the bottom of the file.</li>
            <li>
              Search for <code className="bg-gray-200 text-red-700 font-mono px-1 py-0.5 rounded">window.__firebase_config</code> and replace the placeholder fields with your actual Firebase project config.
            </li>
          </ol>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            You can find these credentials in your Firebase Project Settings under <span className="font-semibold">General &gt; Your apps &gt; SDK setup and configuration</span>.
          </p>
        </div>
         <p className="mt-6 text-gray-600">
          Once you've added your credentials, please refresh this page.
        </p>
      </div>
    </div>
  );

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}



const isConfigured = 
  (import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_API_KEY !== 'YOUR_FIREBASE_API_KEY') ||
  (typeof __firebase_config !== 'undefined' && __firebase_config.apiKey && __firebase_config.apiKey !== 'YOUR_FIREBASE_API_KEY');

import { HelmetProvider } from 'react-helmet-async';

import { ThemeProvider } from './contexts/ThemeContext';

if (isConfigured) {
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
} else {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<SetupRequired />);
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

