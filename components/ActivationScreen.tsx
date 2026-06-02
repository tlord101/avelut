import React, { useState } from 'react';
import type { FirebaseUser } from '../firebase';
import type { UserProfile, AppSettings } from '../types';
import { GoogleGenAI } from '@google/genai';
import { LogoIcon } from './icons/LogoIcon';

interface ActivationScreenProps {
  user: FirebaseUser;
  userProfile: UserProfile;
  appSettings: AppSettings;
  handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  handleLogout: () => void;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const loadPaystackScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if ((window as any).PaystackPop) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  user,
  userProfile,
  appSettings,
  handleProfileUpdate,
  handleLogout,
  addToast,
}) => {
  const [activeTab, setActiveTab] = useState<'premium' | 'token'>('premium');
  const [enteredKey, setEnteredKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const handlePaystackPayment = async () => {
    setIsActivating(true);
    const email = user.email || `${user.uid}@vantutor.com`;
    const amount = 5000 * 100; // 5,000 NGN in kobo
    const publicKey = appSettings.paystack_public_key?.trim();

    if (!publicKey) {
      // Simulation / Demo Mode
      addToast('Demo Mode: Simulating secure checkout...', 'info');
      setTimeout(async () => {
        const result = await handleProfileUpdate({
          is_activated: true,
          subscription_status: 'premium',
          use_personal_token: false,
          paystack_reference: 'demo_' + Math.random().toString(36).substring(2, 11),
        });
        if (result.success) {
          addToast('VanTutor Premium AI activated successfully!', 'success');
        } else {
          addToast('Activation failed. Please try again.', 'error');
        }
        setIsActivating(false);
      }, 2000);
      return;
    }

    const isLoaded = await loadPaystackScript();
    if (!isLoaded) {
      addToast('Could not load payment gateway. Please try again.', 'error');
      setIsActivating(false);
      return;
    }

    try {
      const handler = (window as any).PaystackPop.setup({
        key: publicKey,
        email: email,
        amount: amount,
        currency: 'NGN',
        callback: async (response: any) => {
          const result = await handleProfileUpdate({
            is_activated: true,
            subscription_status: 'premium',
            use_personal_token: false,
            paystack_reference: response?.reference || 'ref_missing',
          });
          if (result.success) {
            addToast('VanTutor Premium AI successfully activated!', 'success');
          } else {
            addToast('Payment received but failed to activate. Contact support.', 'error');
          }
          setIsActivating(false);
        },
        onClose: () => {
          addToast('Payment cancelled.', 'info');
          setIsActivating(false);
        },
      });
      handler.openIframe();
    } catch (e: any) {
      console.error(e);
      addToast('Error during payment processing.', 'error');
      setIsActivating(false);
    }
  };

  const handleTokenActivation = async () => {
    if (!enteredKey.trim()) {
      addToast('Please paste a valid Google Gemini API key.', 'error');
      return;
    }

    setIsActivating(true);
    try {
      const testClient = new GoogleGenAI({ apiKey: enteredKey.trim() });
      const response = await testClient.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });
      if (!response.text) {
        throw new Error('Key validation failed.');
      }

      const result = await handleProfileUpdate({
        is_activated: true,
        subscription_status: 'personal_token',
        personal_api_key: enteredKey.trim(),
        use_personal_token: true,
      });

      if (result.success) {
        addToast('Personal API key verified and activated!', 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (e: any) {
      console.error(e);
      addToast('Invalid API key. Please check Google AI Studio and try again.', 'error');
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-lime-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-80 h-80 bg-brand-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10 animate-fade-in">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl mb-4 animate-bounce">
            <LogoIcon className="w-14 h-14 loader-logo text-lime-400" />
          </div>
          <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-lime-300 via-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Activate VanTutor AI
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-sm">
            We partner with Google AI to bring you curriculum-tailored learning. Choose how you'd like to power your personal companion.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-[28px] p-6 shadow-2xl">
          <div className="grid grid-cols-2 gap-3 mb-6 p-1 bg-slate-950/80 rounded-2xl border border-slate-800/80">
            <button
              onClick={() => setActiveTab('premium')}
              className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === 'premium'
                  ? 'bg-gradient-to-r from-lime-500 to-emerald-600 text-white shadow-lg shadow-lime-500/15'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              👑 Subscribe Premium
            </button>
            <button
              onClick={() => setActiveTab('token')}
              className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === 'token'
                  ? 'bg-gradient-to-r from-lime-500 to-emerald-600 text-white shadow-lg shadow-lime-500/15'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🔑 Personal Token
            </button>
          </div>

          {activeTab === 'premium' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-950 border border-slate-800/60 rounded-2xl p-5">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>VanTutor AI Premium Plan</span>
                  <span className="text-[10px] bg-lime-500/20 text-lime-400 px-2 py-0.5 rounded-full uppercase">Best Choice</span>
                </h3>
                <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                  Enjoy unlimited access to advanced study guides, real timed mock exams, visual problem solvers, and peer Messenger.
                </p>
                <div className="mt-4 flex items-baseline gap-1.5 border-t border-slate-800/80 pt-4">
                  <span className="text-2xl font-black text-white">₦5,000</span>
                  <span className="text-xs text-slate-500">/ semester</span>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handlePaystackPayment}
                  disabled={isActivating}
                  className="w-full py-3.5 bg-gradient-to-r from-lime-500 to-emerald-600 hover:from-lime-400 hover:to-emerald-500 text-slate-950 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-lime-500/20 active:scale-95 disabled:opacity-50"
                >
                  {isActivating ? 'Connecting Gateway...' : 'Pay with Paystack'}
                </button>
                <p className="text-[10px] text-center text-slate-500 leading-normal">
                  Payments are securely processed in partnership with Google AI and Paystack.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in duration-300">
              <div className="bg-slate-950 border border-slate-800/60 rounded-2xl p-5">
                <h3 className="text-md font-bold text-white">Use Free Google Personal Token</h3>
                <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                  Link your own Gemini API key for free. If you don't have one, visit the Google AI Studio console to get your key instantly.
                </p>
                <a
                  href="https://aistudio.google.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs font-black text-lime-400 hover:text-lime-300 hover:underline uppercase tracking-wider"
                >
                  Get Free Key from Google AI Studio ↗
                </a>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder="Enter your Gemini API Key"
                    value={enteredKey}
                    onChange={(e) => setEnteredKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-lime-500 rounded-xl py-3 px-4 pr-12 text-sm text-white placeholder-slate-600 focus:outline-none transition-all font-mono"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-[10px] font-black uppercase"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>

                <button
                  onClick={handleTokenActivation}
                  disabled={isActivating || !enteredKey.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-lime-500 to-emerald-600 hover:from-lime-400 hover:to-emerald-500 text-slate-950 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-lime-500/20 active:scale-95 disabled:opacity-50"
                >
                  {isActivating ? 'Verifying with Google AI...' : 'Activate Personal Key'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-center mt-6">
          <button
            onClick={handleLogout}
            className="text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors"
          >
            Logout & Exit
          </button>
        </div>
      </div>
    </div>
  );
};
