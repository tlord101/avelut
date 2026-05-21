
import React, { useState } from 'react';
import { auth, sendPasswordResetEmail } from '../firebase';
import { useToast } from '../hooks/useToast';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const { addToast } = useToast();

  if (!isOpen) {
    return null;
  }

  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);

    try {
      await sendPasswordResetEmail(auth, email);

      addToast('A password reset link has been sent to your email address.', 'success');
      setIsSent(true);
      setTimeout(onClose, 3000); // Close modal after showing success
    } catch (err: any) {
      addToast(err.message || 'An unexpected error occurred.', 'error');
      console.error('Password reset failed:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
      if (!isSending) {
          // Reset state on close
          setEmail('');
          setIsSent(false);
          onClose();
      }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-2xl w-full max-w-md relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition-colors text-2xl"
          aria-label="Close"
        >
          &times;
        </button>
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Reset Password</h2>
        <p className="text-gray-600 text-center mb-6">
          Enter your email and we'll send you a link to reset your password.
        </p>
        
        {isSent ? (
          <div className="text-center">
            <p className="text-green-700 font-semibold mb-4">Check your inbox for the reset link.</p>
            <button
              onClick={handleClose}
              className="w-full bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendResetLink}>
            <div className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-6">
              <button
                type="submit"
                disabled={isSending}
                className="w-full bg-gradient-to-r from-lime-500 to-teal-500 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSending ? (
                  <>
                    <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span>Sending...</span>
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
