import React, { useState } from 'react';
import type { FirebaseUser } from '../firebase';
import type { UserProfile, AppSettings } from '../types';
import { GoogleGenAI } from '@google/genai';
import { triggerPaystackPurchase } from '../utils/usage';
import { DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';

interface ActivationScreenProps {
  user: FirebaseUser;
  userProfile: UserProfile;
  appSettings: AppSettings;
  handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  handleLogout: () => void;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type SelectedPlan = 'free' | 'basic' | 'pro' | 'token';

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  user,
  userProfile,
  appSettings,
  handleProfileUpdate,
  handleLogout,
  addToast,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<SelectedPlan>('free');
  const [enteredKey, setEnteredKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;
  const plans = usageSettings.plans;

  const handleActivate = async () => {
    if (selectedPlan === 'free') {
      setIsActivating(true);
      try {
        const result = await handleProfileUpdate({
          is_activated: true,
          subscription_status: 'free',
          use_personal_token: false,
        });
        if (result.success) {
          addToast('AVELUT Free AI activated successfully!', 'success');
        } else {
          addToast('Activation failed. Please try again.', 'error');
        }
      } catch (err) {
        console.error(err);
        addToast('Activation failed.', 'error');
      } finally {
        setIsActivating(false);
      }
      return;
    }

    if (selectedPlan === 'token') {
      if (!enteredKey.trim()) {
        addToast('Please paste a valid Google Gemini API key.', 'error');
        return;
      }
      setIsActivating(true);
      try {
        const testClient = new GoogleGenAI({ apiKey: enteredKey.trim() });
        const response = await testClient.models.generateContent({
          model: 'gemini-3.1-flash-lite',
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
        addToast('Invalid API key. Check Google AI Studio and try again.', 'error');
      } finally {
        setIsActivating(false);
      }
      return;
    }

    // Basic or Pro Plans (Trigger Paystack Inline checkout)
    const activePlan = plans[selectedPlan];
    const amount = activePlan.price;
    const publicKey = appSettings.paystack_public_key?.trim();
    const email = user.email || `${user.uid}@avelut.com`;

    setIsActivating(true);

    await triggerPaystackPurchase({
      publicKey,
      email,
      amount,
      userId: user.uid,
      purchaseType: 'subscription',
      metadata: { plan_tier: selectedPlan },
      addToast,
      onSuccess: async (reference) => {
        const result = await handleProfileUpdate({
          is_activated: true,
          subscription_status: selectedPlan,
          use_personal_token: false,
          paystack_reference: reference,
        });
        if (result.success) {
          addToast(`AVELUT ${activePlan.name} activated successfully!`, 'success');
        } else {
          addToast('Payment received but activation failed. Contact support.', 'error');
        }
        setIsActivating(false);
      },
      onCancel: () => {
        setIsActivating(false);
      },
      onError: (err) => {
        console.error(err);
        setIsActivating(false);
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-100/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-purple-100/40 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-4xl relative z-10 animate-fade-in my-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-md mb-4 animate-bounce">
            <img src="/logo_icon.png" alt="AVELUT" className="w-12 h-12 object-contain" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 bg-gradient-to-r from-blue-900 via-purple-800 to-indigo-750 bg-clip-text text-transparent">
            Activate Your Study Companion
          </h1>
          <p className="text-sm text-slate-500 mt-2 max-w-md">
            Choose a plan to customize your personal study roadmap. Get curriculum guidance, mock tests, and visual problem solving.
          </p>
        </div>

        <div className="bg-white border border-slate-200 backdrop-blur-xl rounded-[28px] p-6 sm:p-8 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {/* Free Card */}
            <div
              onClick={() => setSelectedPlan('free')}
              className={`cursor-pointer rounded-2xl border p-5 transition-all flex flex-col justify-between hover:scale-[1.02] ${
                selectedPlan === 'free'
                  ? 'border-blue-600 bg-blue-50/20 shadow-md ring-2 ring-blue-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-350'
              }`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <h3 className="font-extrabold text-sm text-slate-900">{plans.free.name}</h3>
                  <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full font-bold uppercase">Tier 1</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-semibold">
                  {plans.free.description}
                </p>
                <ul className="text-[11px] text-slate-700 mt-4 space-y-2 font-semibold">
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.free.limits.courses === -1 ? 'Unlimited' : plans.free.limits.courses} Courses roadmap</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.free.limits.ai_requests_per_course === -1 ? 'Unlimited' : plans.free.limits.ai_requests_per_course} AI queries/course (2h reset)</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.free.limits.exams === -1 ? 'Unlimited' : plans.free.limits.exams} Exams limit</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.free.limits.visual_messages === -1 ? 'Unlimited' : plans.free.limits.visual_messages} AI assistance chat messages</li>
                </ul>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4">
                <span className="text-xl font-black text-slate-900">Free</span>
                <span className="text-[10px] text-slate-500 font-bold ml-1">/ lifetime</span>
              </div>
            </div>

            {/* Basic Card */}
            <div
              onClick={() => setSelectedPlan('basic')}
              className={`cursor-pointer rounded-2xl border p-5 transition-all flex flex-col justify-between hover:scale-[1.02] ${
                selectedPlan === 'basic'
                  ? 'border-blue-600 bg-blue-50/20 shadow-md ring-2 ring-blue-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-350'
              }`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <h3 className="font-extrabold text-sm text-slate-900">{plans.basic.name}</h3>
                  <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold uppercase">Basic</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-semibold">
                  {plans.basic.description}
                </p>
                <ul className="text-[11px] text-slate-700 mt-4 space-y-2 font-semibold">
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.basic.limits.courses === -1 ? 'Unlimited' : plans.basic.limits.courses} Courses roadmap</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.basic.limits.ai_requests_per_course === -1 ? 'Unlimited' : plans.basic.limits.ai_requests_per_course} AI queries/course (2h reset)</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.basic.limits.exams === -1 ? 'Unlimited' : plans.basic.limits.exams} Practice exams</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.basic.limits.visual_messages === -1 ? 'Unlimited' : plans.basic.limits.visual_messages} Solver messages</li>
                  <li className="flex items-center gap-1.5 text-blue-600">★ Twitter-style blue badge</li>
                </ul>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4">
                <span className="text-xl font-black text-slate-900">₦{(plans.basic.price).toLocaleString()}</span>
                <span className="text-[10px] text-slate-500 font-bold ml-1">/ semester</span>
              </div>
            </div>

            {/* Pro Card */}
            <div
              onClick={() => setSelectedPlan('pro')}
              className={`cursor-pointer rounded-2xl border p-5 transition-all flex flex-col justify-between hover:scale-[1.02] ${
                selectedPlan === 'pro'
                  ? 'border-purple-600 bg-purple-50/20 shadow-md ring-2 ring-purple-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-350'
              }`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <h3 className="font-extrabold text-sm text-slate-900">{plans.pro.name}</h3>
                  <span className="text-[10px] bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-bold uppercase">Pro</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-semibold">
                  {plans.pro.description}
                </p>
                <ul className="text-[11px] text-slate-700 mt-4 space-y-2 font-semibold">
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.pro.limits.courses === -1 ? 'Unlimited' : plans.pro.limits.courses} Courses roadmap</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.pro.limits.ai_requests_per_course === -1 ? 'Unlimited' : plans.pro.limits.ai_requests_per_course} AI queries/course (2h reset)</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.pro.limits.exams === -1 ? 'Unlimited' : plans.pro.limits.exams} Practice exams</li>
                  <li className="flex items-center gap-1.5 text-slate-600">✓ {plans.pro.limits.visual_messages === -1 ? 'Unlimited' : plans.pro.limits.visual_messages} Solver messages</li>
                  <li className="flex items-center gap-1.5 text-purple-600">★ Purple checkmark badge</li>
                </ul>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4">
                <span className="text-xl font-black text-slate-900">₦{(plans.pro.price).toLocaleString()}</span>
                <span className="text-[10px] text-slate-500 font-bold ml-1">/ semester</span>
              </div>
            </div>

            {/* Use Personal Gemini Token Card */}
            <div
              onClick={() => setSelectedPlan('token')}
              className={`cursor-pointer rounded-2xl border p-5 transition-all flex flex-col justify-between hover:scale-[1.02] ${
                selectedPlan === 'token'
                  ? 'border-emerald-600 bg-emerald-50/20 shadow-md ring-2 ring-emerald-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-350'
              }`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <h3 className="font-extrabold text-sm text-slate-900">Use Developer Key</h3>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold uppercase">Token</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-semibold">
                  Provide your own Google Gemini AI key and activate account for free.
                </p>
                <ul className="text-[11px] text-slate-700 mt-4 space-y-2 font-semibold">
                  <li className="flex items-center gap-1.5 text-emerald-700 font-bold">✓ Unlimited courses</li>
                  <li className="flex items-center gap-1.5 text-emerald-700 font-bold">✓ Unlimited AI requests</li>
                  <li className="flex items-center gap-1.5 text-emerald-700 font-bold">✓ Unlimited solver chat</li>
                  <li className="flex items-center gap-1.5 text-emerald-700 font-bold">✓ Developer badge next to name</li>
                </ul>
              </div>
              <div className="mt-6 border-t border-emerald-150 pt-4">
                <span className="text-xl font-black text-emerald-950">Free / Token</span>
                <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">Use your Google AI Key</span>
              </div>
            </div>
          </div>

          {selectedPlan === 'token' && (
            <div className="bg-slate-55 border border-slate-200 rounded-2xl p-5 mb-6 space-y-4 animate-in fade-in duration-300">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Add Google AI Token</h4>
                <p className="text-slate-500 text-[11px] mt-1 font-semibold">
                  Link your own Gemini API key for free. If you don't have one, visit the{' '}
                  <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold">
                    Google AI Studio
                  </a>{' '}
                  to copy your token.
                </p>
              </div>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="Paste Gemini API Key here"
                  value={enteredKey}
                  onChange={(e) => setEnteredKey(e.target.value)}
                  className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-xl py-3 px-4 pr-12 text-sm text-slate-800 placeholder-slate-400 focus:outline-none transition-all font-mono shadow-sm"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 text-[10px] font-black uppercase"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleActivate}
              disabled={isActivating || (selectedPlan === 'token' && !enteredKey.trim())}
              className="w-full py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
            >
              {isActivating ? 'Activating Connection...' : 'Continue & Activate'}
            </button>
            <p className="text-[10px] text-center text-slate-400 font-semibold leading-relaxed">
              Subscriptions are handled securely in partnership with Google AI and Paystack payments processor.
            </p>
          </div>
        </div>

        <div className="flex justify-center mt-6">
          <button
            onClick={handleLogout}
            className="text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors"
          >
            Logout & Exit
          </button>
        </div>
      </div>
    </div>
  );
};
