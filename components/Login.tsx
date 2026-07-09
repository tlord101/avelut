
import React, { useState } from 'react';
import { auth, googleProvider, signInWithPopup, signInWithEmailAndPassword } from '../firebase';
import { signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { ref as dbRef, set, get } from 'firebase/database';
import { db } from '../firebase';
import { GoogleIcon } from './icons/GoogleIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeOffIcon } from './icons/EyeOffIcon';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { useToast } from '../hooks/useToast';
import { isNative, triggerHaptic } from '../utils/capacitorUtils';

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
    void triggerHaptic();
    setIsGoogleSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      if (isNative()) {
        // Use @capacitor-firebase/authentication for native Google Sign-In (Capacitor 8 compatible)
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        const accessToken = result.credential?.accessToken;
        if (!idToken) {
          throw new Error('No ID token returned from Google Sign-In.');
        }
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        const fbResult = await signInWithCredential(auth, credential);
        
        const user = fbResult.user;
        const userRef = dbRef(db, `users/${user.uid}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) {
          await set(userRef, {
            uid: user.uid,
            display_name: user.displayName || 'User',
            email: user.email || '',
            photo_url: user.photoURL || '',
            created_at: Date.now()
          });
          sessionStorage.setItem('just_signed_up', 'true');
        }
      } else {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const userRef = dbRef(db, `users/${user.uid}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) {
          await set(userRef, {
            uid: user.uid,
            display_name: user.displayName || 'User',
            email: user.email || '',
            photo_url: user.photoURL || '',
            created_at: Date.now()
          });
          sessionStorage.setItem('just_signed_up', 'true');
        }
      }
      // On successful sign-in, onAuthStateChanged will trigger in App.tsx
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
    void triggerHaptic();
    setIsSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // On successful login, onAuthStateChanged in App.tsx will handle the state change.
    } catch (err: any) {
      let errorMessage = err.message || 'An unexpected error occurred.';
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        errorMessage = 'Incorrect email or password. Please try again.';
      }
      console.error('Login failed:', err);
      addToast(errorMessage, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="flex justify-center mb-6">
                <img src="/logo_full.png" alt="AVELUT Logo" className="h-16 object-contain" />
            </div>
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold  dark:text-white tracking-wider">Welcome Back</h2>
              <p className="text-gray-600 mt-2">Log in to continue your learning.</p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
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
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3  dark:text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                      Password
                    </label>
                    <button
                        type="button"
                        onClick={() => { void triggerHaptic(); setIsForgotPasswordOpen(true); }}
                        className="text-sm font-medium text-lime-600 hover:text-lime-500 hover:underline focus:outline-none transition-all duration-200 active:scale-95"
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
                      className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 pl-3 pr-10  dark:text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => { void triggerHaptic(); setShowPassword(!showPassword); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-lime-500 rounded focus:outline-none transition-all duration-200 active:scale-95"
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
                  className="w-full bg-gradient-to-r from-lime-500 to-teal-500 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink mx-4 text-gray-500 text-xs uppercase">Or continue with</span>
                <div className="flex-grow border-t border-gray-200"></div>
            </div>

            <button
                onClick={handleGoogleSignIn}
                disabled={isSubmitting || isGoogleSubmitting}
                className="w-full bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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

            <p className="text-center text-sm text-gray-600 mt-6">
              Don't have an account?{' '}
              <button onClick={() => { void triggerHaptic(); onSwitchToSignUp(); }} className="font-medium text-lime-600 hover:text-lime-500 transition-all duration-200 active:scale-95">
                Sign Up
              </button>
            </p>

            <div className="mt-6 text-center text-xs text-gray-500 space-x-2">
              <a href="/t&c" className="underline hover:text-gray-700">Terms &amp; Conditions</a>
              <a href="https://www.avelut.xyz/policy" className="underline hover:text-gray-700">Privacy Policy</a>
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
