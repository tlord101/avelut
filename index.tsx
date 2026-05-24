
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './hooks/useToast';
import { LogoIcon } from './components/icons/LogoIcon';

declare var __firebase_config: any;

// ... (SetupRequired component stays the same)
const SetupRequired: React.FC = () => (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-2xl text-center bg-white p-8 rounded-2xl shadow-2xl border border-red-200">
        <LogoIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-red-600">Configuration Required</h1>
        <p className="mt-4 text-lg text-gray-700">
          Welcome to VANTUTOR! To get started, you need to connect the application to your Firebase project.
        </p>
        <div className="mt-6 text-left bg-gray-50 p-6 rounded-lg border border-gray-200">
          <p className="font-semibold text-gray-800">Please follow these steps:</p>
          <ol className="list-decimal list-inside mt-2 space-y-2 text-gray-600">
            <li>Open the <code className="bg-gray-200 text-red-700 font-mono px-1 py-0.5 rounded">index.html</code> file in your project.</li>
            <li>Find the script tag near the bottom of the file.</li>
            <li>
              Search for <code className="bg-gray-200 text-red-700 font-mono px-1 py-0.5 rounded">window.__firebase_config</code> and replace the placeholder fields with your actual Firebase project config.
            </li>
          </ol>
          <p className="mt-4 text-sm text-gray-500">
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

const root = ReactDOM.createRoot(rootElement);

const isConfigured = 
  typeof __firebase_config !== 'undefined' && __firebase_config.apiKey && __firebase_config.apiKey !== 'YOUR_FIREBASE_API_KEY';

const router = createBrowserRouter([
  {
    path: '/*',
    element: <App />,
  }
]);

if (isConfigured) {
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </React.StrictMode>
  );
} else {
  root.render(<SetupRequired />);
}
