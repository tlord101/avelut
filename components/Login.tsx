import React, { useState } from 'react';
import { supabaseAuthService } from '../services/supabaseAuthService';
import { GoogleIcon } from './icons/GoogleIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeOffIcon } from './icons/EyeOffIcon';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { useToast } from '../hooks/useToast';

interface LoginProps {
    onSwitchToSignUp: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSwitchToSignUp }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const { addToast } = useToast();

  const handleGoogleSignIn = async () => {
    setIsGoogleSubmitting(true);
    try {
      const { error } = await supabaseAuthService.signInWithGoogle();
      if (error) {
        throw new Error(error);
      }
    } catch (err: any) {
      if (err.message !== 'The user cancelled the sign-in flow.') {
        addToast(err.message || 'Failed to sign in with Google.', 'error');
      }
      console.error('Google sign in failed:', err);
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await supabaseAuthService.signInWithEmail(email, password);
      if (res.error) {
        let errorMessage = res.error;
        if (errorMessage.toLowerCase().includes('invalid login credentials')) {
          errorMessage = 'Incorrect email or password. Please try again.';
        }
        addToast(errorMessage, 'error');
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      addToast(err.message || 'An unexpected error occurred.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-zinc-950 p-4 transition-colors">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="flex justify-center mb-6">
                <img src="/logo_full_black.png" alt="AVELUT Logo" className="h-16 object-contain dark:hidden" />
                <img src="/logo_full_white.png" alt="AVELUT Logo" className="h-16 object-contain hidden dark:block" />
            </div>
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-wider">Welcome Back</h2>
              <p className="text-gray-600 dark:text-zinc-400 mt-2">Log in to continue your learning.</p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg py-2.5 px-3 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:ring-2 focus:ring-lime-500 focus:border-lime-500 focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
                      Password
                    </label>
                    <button
                        type="button"
                        onClick={() => setIsForgotPasswordOpen(true)}
                        className="text-sm font-medium text-lime-600 dark:text-lime-400 hover:text-lime-500 hover:underline focus:outline-none"
                    >
                        Forgot Password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg py-2.5 pl-3 pr-10 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:ring-2 focus:ring-lime-500 focus:border-lime-500 focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-lime-500 rounded focus:outline-none"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOffIcon className="w-5 h-5" />
                      ) : (
                        <EyeIcon className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="mt-8">
                <button
                  type="submit"
                  disabled={isSubmitting || isGoogleSubmitting}
                  className="w-full bg-gradient-to-r from-lime-500 to-teal-500 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md shadow-lime-500/20"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>Logging In...</span>
                    </>
                  ) : (
                    'Log In'
                  )}
                </button>
              </div>
            </form>

            <div className="relative flex py-5 items-center">
                <div className="flex-grow border-t border-gray-200 dark:border-zinc-800"></div>
                <span className="flex-shrink mx-4 text-gray-500 dark:text-zinc-400 text-xs uppercase">Or continue with</span>
                <div className="flex-grow border-t border-gray-200 dark:border-zinc-800"></div>
            </div>

            <button
                onClick={handleGoogleSignIn}
                disabled={isSubmitting || isGoogleSubmitting}
                className="w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-200 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700/80 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-sm"
            >
                {isGoogleSubmitting ? (
                    <>
                      <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>Signing In...</span>
                    </>
                ) : (
                    <>
                        <GoogleIcon className="w-5 h-5 mr-3" />
                        Sign In with Google
                    </>
                )}
            </button>

            <p className="text-center text-sm text-gray-600 dark:text-zinc-400 mt-6">
              Don't have an account?{' '}
              <button onClick={onSwitchToSignUp} className="font-semibold text-lime-600 dark:text-lime-400 hover:text-lime-500">
                Sign Up
              </button>
            </p>

            <div className="mt-6 text-center text-xs text-gray-500 dark:text-zinc-500 space-x-2">
              <a href="/t&c" className="underline hover:text-gray-700 dark:hover:text-zinc-300">Terms &amp; Conditions</a>
              <span>&middot;</span>
              <a href="https://www.avelut.xyz/policy" className="underline hover:text-gray-700 dark:hover:text-zinc-300">Privacy Policy</a>
            </div>

          </div>
        </div>
      </div>
      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
      />
    </>
  );
};
