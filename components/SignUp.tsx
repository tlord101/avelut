
import React, { useState } from 'react';
import { auth, db, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from '../firebase';
import { ref as dbRef, set } from 'firebase/database';
import { LogoIcon } from './icons/LogoIcon';
import { GoogleIcon } from './icons/GoogleIcon';
import { useToast } from '../hooks/useToast';

interface SignUpProps {
    onSwitchToLogin: () => void;
}

export const SignUp: React.FC<SignUpProps> = ({ onSwitchToLogin }) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const { addToast } = useToast();

  const handleGoogleSignIn = async () => {
    setIsGoogleSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      await set(dbRef(db, `users/${user.uid}`), {
        uid: user.uid,
        display_name: user.displayName || 'Learner',
        email: user.email || '',
        photo_url: user.photoURL || '',
        created_at: Date.now()
      });
      // On successful sign-in, onAuthStateChanged in App.tsx will trigger.
    } catch (err: any) {
      addToast(err.message || 'Failed to sign in with Google.', 'error');
      console.error('Google sign in failed:', err);
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (displayName.trim() === '') {
        addToast('Please enter your name.', 'error');
        return;
    }
    setIsSubmitting(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      await updateProfile(user, { displayName: displayName.trim() });
      
      // Initialize user profile in RTDB
      await set(dbRef(db, `users/${user.uid}`), {
        uid: user.uid,
        display_name: displayName.trim(),
        email: user.email,
        created_at: Date.now()
      });

      addToast("Account created successfully!", "success");
      // onAuthStateChanged in App.tsx will handle the state change.
    } catch (err: any) {
      let errorMessage = err.message || 'Failed to create an account.';
      console.error('Sign up failed:', err);
      addToast(errorMessage, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="flex justify-center items-center mb-6">
              <LogoIcon className="w-12 h-12 text-lime-500" />
              <h1 className="text-3xl font-bold bg-gradient-to-b from-lime-500 to-green-600 text-transparent bg-clip-text tracking-wider ml-3">
                  VANTUTOR
              </h1>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-wider">Create Account</h2>
            <p className="text-gray-600 mt-2">Join VANTUTOR to start learning.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                  Display Name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
              </div>

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
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
              </div>
            </div>
            
            <div className="mt-8">
              <button
                type="submit"
                disabled={isSubmitting || isGoogleSubmitting}
                className="w-full bg-gradient-to-r from-lime-500 to-teal-500 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSubmitting ? (
                  <>
                    <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span>Creating Account...</span>
                  </>
                ) : (
                  'Sign Up'
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
              className="w-full bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
              {isGoogleSubmitting ? (
                  <>
                      <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>Signing In...</span>
                  </>
              ) : (
                  <>
                      <GoogleIcon className="w-5 h-5 mr-3" />
                      Sign Up with Google
                  </>
              )}
          </button>
          
          <p className="text-center text-sm text-gray-600 mt-6">
            Already have an account?{' '}
            <button onClick={onSwitchToLogin} className="font-medium text-lime-600 hover:text-lime-500">
              Log In
            </button>
          </p>

        </div>
      </div>
    </div>
  );
};
