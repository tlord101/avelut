
import React, { useState } from 'react';
import { auth, db, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from '../firebase';
import { signInWithCredential } from 'firebase/auth';
import { ref as dbRef, set, get } from 'firebase/database';
import { GoogleIcon } from './icons/GoogleIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeOffIcon } from './icons/EyeOffIcon';
import { useToast } from '../hooks/useToast';
import { isNative, triggerHaptic } from '../utils/capacitorUtils';

interface SignUpProps {
    onSwitchToLogin: () => void;
}

export const SignUp: React.FC<SignUpProps> = ({ onSwitchToLogin }) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const { addToast } = useToast();

  const handleGoogleSignIn = async () => {
    void triggerHaptic();
    setIsGoogleSubmitting(true);
    try {
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const { ip } = await ipRes.json();
      const ipRef = dbRef(db, `ip_logs/${ip.replace(/[\.#$\[\]]/g, '_').replace(/:/g, '_')}`);
      const ipSnap = await get(ipRef);
      if (ipSnap.exists()) {
          addToast('An account has already been created from this device/IP.', 'error');
          setIsGoogleSubmitting(false);
          return;
      }

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
          await set(ipRef, { uid: user.uid, timestamp: Date.now() });
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
          await set(ipRef, { uid: user.uid, timestamp: Date.now() });
          sessionStorage.setItem('just_signed_up', 'true');
        }
      }
      // On successful sign-in, onAuthStateChanged in App.tsx will trigger.
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
    if (displayName.trim() === '') {
        addToast('Please enter your name.', 'error');
        return;
    }
    setIsSubmitting(true);

    try {
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const { ip } = await ipRes.json();
      const ipRef = dbRef(db, `ip_logs/${ip.replace(/[\.#$\[\]]/g, '_').replace(/:/g, '_')}`);
      const ipSnap = await get(ipRef);
      if (ipSnap.exists()) {
          addToast('An account has already been created from this device/IP.', 'error');
          setIsSubmitting(false);
          return;
      }

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
      await set(ipRef, { uid: user.uid, timestamp: Date.now() });

      sessionStorage.setItem('just_signed_up', 'true');
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
          <div className="flex justify-center mb-6">
              <img src="/logo_full.png" alt="AVELUT Logo" className="h-16 object-contain" />
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold  dark:text-white tracking-wider">Create Account</h2>
            <p className="text-gray-600 mt-2">Join AVELUT to start learning.</p>
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
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3  dark:text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
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
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3  dark:text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
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
                      Sign Up with Google
                  </>
              )}
          </button>
          
          <p className="text-center text-sm text-gray-600 mt-6">
            Already have an account?{' '}
            <button onClick={() => { void triggerHaptic(); onSwitchToLogin(); }} className="font-medium text-lime-600 hover:text-lime-500 transition-all duration-200 active:scale-95">
              Log In
            </button>
          </p>

          <div className="mt-6 text-center text-xs text-gray-500 space-x-2">
            <a href="/t&c" className="underline hover:text-gray-700">Terms & Conditions</a>
            <span>&middot;</span>
            <a href="https://www.avelut.xyz/policy" className="underline hover:text-gray-700">Privacy Policy</a>
          </div>

        </div>
      </div>
    </div>
  );
};
