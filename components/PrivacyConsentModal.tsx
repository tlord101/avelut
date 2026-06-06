import React from 'react';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';

interface PrivacyConsentModalProps {
  onAllow: () => void;
  onDeny: () => void;
}

export const PrivacyConsentModal: React.FC<PrivacyConsentModalProps> = ({ onAllow, onDeny }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 backdrop-blur-sm privacy-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-title"
    >
      <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-2xl w-full max-w-md relative privacy-modal-content">
        <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-lime-100 text-lime-600 rounded-full flex items-center justify-center mb-4">
                <ShieldCheckIcon className="w-8 h-8"/>
            </div>
            <h2 id="privacy-title" className="text-2xl font-bold text-gray-900">Your Privacy Matters</h2>
            <p className="text-gray-600 mt-4">
                To enhance security and personalize your experience, AVELUT collects data about your site activity. This helps us protect your account and improve our services.
            </p>
            <p className="text-gray-600 mt-2">
                Do you consent to this data collection? You can change this in your browser settings at any time.
            </p>
        </div>
        <div className="flex justify-end gap-4 mt-8">
          <button
            onClick={onDeny}
            className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 transition-colors"
          >
            Deny
          </button>
          <button
            onClick={onAllow}
            className="px-4 py-2 rounded-lg bg-lime-600 text-white font-semibold hover:bg-lime-700 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
};