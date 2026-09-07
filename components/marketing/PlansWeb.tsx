import React, { useState, useEffect } from 'react';
import { DEFAULT_USAGE_SETTINGS } from '../../utils/appSettings';
import type { AppSettings, UserProfile } from '../../types';
import { triggerPaystackPurchase } from '../../utils/usage';
import { useToast } from '../../hooks/useToast';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { saveLocalCredits } from '../../services/creditsStorageService';

interface PlansWebProps {
    appSettings: AppSettings;
    userProfile?: UserProfile;
}

export const PlansWeb: React.FC<PlansWebProps> = ({ appSettings, userProfile }) => {
    const [email, setEmail] = useState<string>(userProfile?.email || '');
    const [isProcessing, setIsProcessing] = useState(false);
    const { addToast } = useToast();

    const usageSettings = appSettings?.usage_settings || DEFAULT_USAGE_SETTINGS;
    const tiers = usageSettings?.tiers || (usageSettings as any)?.plans || DEFAULT_USAGE_SETTINGS.tiers;

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const selectedPlan = searchParams.get('plan');
        
        if (selectedPlan) {
            setTimeout(() => {
                const el = document.getElementById(`plan-${selectedPlan}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 500);
        }
    }, []);

    const handlePurchasePlan = async (planKey: string, priceNgn: number, creditAlloc: number) => {
        const searchParams = new URLSearchParams(window.location.search);
        const targetUid = userProfile?.uid || searchParams.get('uid');
        const emailFromParam = searchParams.get('email');
        const finalEmail = email || emailFromParam || userProfile?.email;

        if (planKey === 'free') return;

        if (!targetUid) {
            alert("Please log in to purchase a plan.");
            return;
        }
        if (!finalEmail || !finalEmail.includes('@')) {
            alert("Please enter a valid email address to receive your receipt.");
            return;
        }
        if (!appSettings.paystack_public_key) {
            alert("Payment gateway is not configured yet.");
            return;
        }

        setIsProcessing(true);
        try {
            await triggerPaystackPurchase({
                publicKey: appSettings.paystack_public_key,
                email: finalEmail.trim(),
                amount: priceNgn,
                userId: targetUid,
                purchaseType: 'subscription',
                metadata: { plan_key: planKey, credit_amount: creditAlloc },
                addToast,
                onSuccess: async (reference) => {
                    try {
                        if (isSupabaseConfigured && targetUid) {
                            await supabase.from('profiles').update({
                                is_paid_subscriber: true,
                                ai_credits: creditAlloc,
                                updated_at: new Date().toISOString(),
                            }).eq('id', targetUid);

                            await supabase.from('subscriptions').upsert({
                                user_id: targetUid,
                                plan_type: planKey,
                                status: 'active',
                                paystack_reference: reference,
                                starts_at: new Date().toISOString(),
                            });
                        }
                        saveLocalCredits(targetUid, creditAlloc, planKey).catch(console.warn);

                        try {
                            await fetch('/api/paystack-verify', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reference, userId: targetUid }),
                            });
                        } catch (fnErr) {
                            console.warn('[PlansWeb] Cloud verification notice:', fnErr);
                        }

                        addToast('Payment successful! Your plan and credits have been activated.', 'success');
                        setTimeout(() => {
                            window.location.href = '/payment-success';
                        }, 800);
                    } finally {
                        setIsProcessing(false);
                    }
                },
                onCancel: () => {
                    addToast('Payment was cancelled.', 'info');
                    setIsProcessing(false);
                },
                onError: (err) => {
                    console.error("Paystack error", err);
                    addToast((err as any)?.message || 'Payment failed to initialize.', 'error');
                    setIsProcessing(false);
                }
            });
        } catch (err) {
            console.error(err);
            addToast("Failed to initialize payment", "error");
            setIsProcessing(false);
        }
    };

    const currentStatus = userProfile?.subscription_status || 'free';

    return (
        <div className="min-h-screen bg-[#F6F6F3] text-[#0F172A] font-sans pb-28">
            {/* Header */}
            <header className="bg-white border-b border-[#E3E9F1] sticky top-0 z-50 shadow-2xs">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <a href="/" className="flex items-center gap-3">
                        <img src="/logo_icon.png" alt="AVELUT" className="w-8 h-8 object-contain" />
                        <span className="text-lg font-black tracking-tight text-[#0F172A]">
                            AVELUT <span className="text-[#0066FF] font-extrabold">Plans</span>
                        </span>
                    </a>
                    <a
                        href="/refill-credits"
                        className="text-xs font-bold text-[#0066FF] hover:text-[#002D62] bg-[#F1F5F9] px-3.5 py-1.5 rounded-full border border-[#E3E9F1] transition-colors"
                    >
                        Buy Credits Pay-As-You-Go →
                    </a>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-12 animate-fade-in">
                {/* Hero Title */}
                <div className="text-center max-w-2xl mx-auto space-y-3">
                    <span className="text-[11px] font-black uppercase tracking-widest text-[#0066FF] bg-[#F1F5F9] px-3.5 py-1 rounded-full border border-[#E3E9F1]">
                        Academic Subscription Tiers
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-black text-[#0F172A] tracking-tight">
                        Power Your Studies with AI
                    </h1>
                    <p className="text-sm sm:text-base text-[#64748B] font-medium leading-relaxed">
                        Choose the plan that matches your study rhythm. Unlock interactive whiteboard Live Voice Tutorials, unlimited AI chat, and textbook solver tools.
                    </p>
                </div>

                {/* Email Input for Receipt */}
                <div className="max-w-md mx-auto">
                    <label className="block text-xs font-bold text-[#64748B] mb-1.5 text-center">
                        Billing Email Address
                    </label>
                    <input 
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter email address for official receipt"
                        className="bg-white border border-[#E3E9F1] text-[#0F172A] text-center font-bold text-sm rounded-2xl focus:ring-2 focus:ring-[#0066FF] focus:border-transparent block w-full py-3 px-5 shadow-2xs outline-none"
                    />
                </div>

                {/* 3 Subscription Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto pt-2">
                    
                    {/* 1. Weekly Plan */}
                    <div id="plan-weekly" className="bg-white border border-[#E3E9F1] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between hover:border-[#0066FF]/40 transition-all relative">
                        <div className="space-y-4">
                            <div>
                                <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                                    Flexible Term
                                </span>
                                <h3 className="text-xl font-black text-[#0F172A] mt-0.5">Weekly Plan</h3>
                            </div>

                            <div className="flex items-baseline gap-1.5 pt-1">
                                <span className="text-3xl sm:text-4xl font-black text-[#0F172A]">₦1,200</span>
                                <span className="text-xs font-bold text-[#64748B]">/ week</span>
                            </div>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                                Great for test preparation and focused weekly revision sessions.
                            </p>

                            <div className="border-t border-[#E3E9F1] pt-4 space-y-2.5">
                                <FeatureItem text="Unlimited Chat Tutorial per day" included />
                                <FeatureItem text="1 Live Tutorial topic / day (7 topics per week)" included highlight />
                                <FeatureItem text="Unlimited Camera Scans per day" included />
                                <FeatureItem text="Unlimited Textbook Uploads" included />
                                <FeatureItem text="3 Flashcard generations / day" included />
                                <FeatureItem text="3 Quizzes / day" included />
                                <FeatureItem text="All content saved for Offline Access" included />
                            </div>
                        </div>

                        <div className="pt-6">
                            <button
                                type="button"
                                onClick={() => handlePurchasePlan('weekly', 1200, 500)}
                                disabled={isProcessing || !email || currentStatus === 'weekly'}
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all cursor-pointer shadow-2xs active:scale-95 ${
                                    currentStatus === 'weekly'
                                        ? 'bg-[#F1F5F9] text-[#64748B] cursor-default'
                                        : 'bg-[#0066FF] hover:bg-slate-900 text-white'
                                }`}
                            >
                                {currentStatus === 'weekly' ? 'Current Plan' : 'Subscribe Weekly'}
                            </button>
                        </div>
                    </div>

                    {/* 2. Monthly Plan (Featured) */}
                    <div id="plan-monthly" className="bg-white border-2 border-[#0066FF] rounded-3xl p-6 sm:p-7 shadow-lg flex flex-col justify-between relative transform md:-translate-y-2">
                        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#0066FF] text-white text-[10px] font-black uppercase tracking-wider rounded-full shadow-sm">
                            Most Popular
                        </div>

                        <div className="space-y-4">
                            <div>
                                <span className="text-[11px] font-bold text-[#0066FF] uppercase tracking-wider block">
                                    Standard Term
                                </span>
                                <h3 className="text-xl font-black text-[#0F172A] mt-0.5">Monthly Plan</h3>
                            </div>

                            <div className="flex items-baseline gap-1.5 pt-1">
                                <span className="text-3xl sm:text-4xl font-black text-[#0F172A]">₦4,000</span>
                                <span className="text-xs font-bold text-[#64748B]">/ month</span>
                            </div>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                                Complete mastery package for active students studying multiple courses.
                            </p>

                            <div className="border-t border-[#E3E9F1] pt-4 space-y-2.5">
                                <FeatureItem text="Unlimited Chats per day" included />
                                <FeatureItem text="Max 3 Live Tutorial topics / day (15 per month)" included highlight />
                                <FeatureItem text="50 credits deducted per Q&A question in Live Tutorial" included />
                                <FeatureItem text="Unlimited Camera Scans per day" included />
                                <FeatureItem text="Unlimited Textbook Uploads" included />
                                <FeatureItem text="Unlimited Flashcards per day" included />
                                <FeatureItem text="Unlimited Quizzes & Tests" included />
                                <FeatureItem text="All content saved for Offline Access" included />
                            </div>
                        </div>

                        <div className="pt-6">
                            <button
                                type="button"
                                onClick={() => handlePurchasePlan('monthly', 4000, 2500)}
                                disabled={isProcessing || !email || currentStatus === 'monthly' || currentStatus === 'premium'}
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all cursor-pointer shadow-md active:scale-95 ${
                                    currentStatus === 'monthly' || currentStatus === 'premium'
                                        ? 'bg-[#F1F5F9] text-[#64748B] cursor-default'
                                        : 'bg-[#0066FF] hover:bg-slate-900 text-white'
                                }`}
                            >
                                {currentStatus === 'monthly' || currentStatus === 'premium' ? 'Current Plan' : 'Subscribe Monthly'}
                            </button>
                        </div>
                    </div>

                    {/* 3. Semester Plan (Best Value) */}
                    <div id="plan-semester" className="bg-white border border-[#E3E9F1] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between hover:border-[#0066FF]/40 transition-all relative">
                        <div className="absolute -top-3.5 right-6 px-3.5 py-1 bg-[#0F172A] text-white text-[10px] font-black uppercase tracking-wider rounded-full shadow-sm">
                            Best Value
                        </div>

                        <div className="space-y-4">
                            <div>
                                <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                                    Full Semester
                                </span>
                                <h3 className="text-xl font-black text-[#0F172A] mt-0.5">Semester Plan</h3>
                            </div>

                            <div className="flex items-baseline gap-1.5 pt-1">
                                <span className="text-3xl sm:text-4xl font-black text-[#0F172A]">₦12,000</span>
                                <span className="text-xs font-bold text-[#64748B]">/ semester</span>
                            </div>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                                Uninterrupted access for the entire semester. Maximum savings.
                            </p>

                            <div className="border-t border-[#E3E9F1] pt-4 space-y-2.5">
                                <FeatureItem text="All Monthly Plan features included" included />
                                <FeatureItem text="Max 3 Live Tutorial topics / day (15 per month)" included highlight />
                                <FeatureItem text="50 credits per Q&A question in Live Tutorial" included />
                                <FeatureItem text="Unlimited Chats, Scans & Uploads" included />
                                <FeatureItem text="Unlimited Flashcards & Quizzes" included />
                                <FeatureItem text="Priority AI tutor processing" included />
                                <FeatureItem text="All content saved Offline — incl. Live Tutorial" included />
                                <FeatureItem text="Official Verification Student Badge" included />
                            </div>
                        </div>

                        <div className="pt-6">
                            <button
                                type="button"
                                onClick={() => handlePurchasePlan('semester', 12000, 8000)}
                                disabled={isProcessing || !email || currentStatus === 'semester'}
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all cursor-pointer shadow-2xs active:scale-95 ${
                                    currentStatus === 'semester'
                                        ? 'bg-[#F1F5F9] text-[#64748B] cursor-default'
                                        : 'bg-[#0F172A] hover:bg-slate-800 text-white'
                                }`}
                            >
                                {currentStatus === 'semester' ? 'Current Plan' : 'Get Semester Access'}
                            </button>
                        </div>
                    </div>

                </div>

                {/* Free Tier Limits Comparison Section */}
                <div className="bg-white border border-[#E3E9F1] rounded-3xl p-6 sm:p-8 shadow-xs max-w-5xl mx-auto space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3E9F1] pb-4">
                        <div>
                            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">
                                Default Account
                            </span>
                            <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                                Free Tier Specifications & Limits
                            </h3>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F1F5F9] text-[#64748B] rounded-full text-xs font-bold border border-[#E3E9F1]">
                            <i className="bi bi-shield-check text-[#0066FF]"></i> Standard Account
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] block">Notebooks & Storage</span>
                            <p className="text-[#64748B]">Up to 100 notebooks per account, 50 sources per notebook.</p>
                        </div>
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] block">Source File Limits</span>
                            <p className="text-[#64748B]">Up to 500,000 words or 200 MB per individual source.</p>
                        </div>
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] block">Chat Queries</span>
                            <p className="text-[#64748B]">50 AI chat messages per day (Notebook & Study Guide).</p>
                        </div>
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] block">Visual Solver Scans</span>
                            <p className="text-[#64748B]">3 camera problem scans per day.</p>
                        </div>
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] block">Overviews & Research</span>
                            <p className="text-[#64748B]">10 deep research/month, 3 audio & 3 video overviews/day.</p>
                        </div>
                        <div className="p-4 bg-[#F6F6F3] rounded-2xl border border-[#E3E9F1] space-y-1">
                            <span className="font-bold text-[#0F172A] flex items-center gap-1.5">
                                <i className="bi bi-lock-fill text-amber-500"></i>
                                Live Voice Tutorial
                            </span>
                            <p className="text-[#64748B]">Locked on Free Tier. Available via Plan or ₦300/topic pass.</p>
                        </div>
                    </div>
                </div>

                {/* Pay As You Go Banner */}
                <div className="bg-gradient-to-br from-[#0F172A] to-[#000000] text-white rounded-3xl p-6 sm:p-8 max-w-5xl mx-auto shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-1.5 text-center md:text-left">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#0066FF] bg-white/10 px-3 py-0.5 rounded-full inline-block">
                            Pay-As-You-Go Credits
                        </span>
                        <h4 className="text-lg sm:text-xl font-black">Don't need a weekly subscription?</h4>
                        <p className="text-xs text-slate-300 max-w-md">
                            Buy single Live Tutorial topic passes at <strong className="text-white">₦300 per topic</strong> or flashcard packs at <strong className="text-white">₦50 per flashcard</strong>.
                        </p>
                    </div>
                    <a
                        href="/refill-credits"
                        className="px-6 py-3 bg-white text-[#0F172A] hover:bg-[#F6F6F3] font-black text-xs sm:text-sm rounded-2xl shadow-sm active:scale-95 transition-all shrink-0 cursor-pointer"
                    >
                        Buy Extra Credits (₦300) →
                    </a>
                </div>
            </main>
        </div>
    );
};

const FeatureItem: React.FC<{ text: string; included: boolean; highlight?: boolean }> = ({ text, included, highlight }) => (
    <div className="flex items-start gap-2.5 text-xs font-medium leading-relaxed">
        {included ? (
            <i className={`bi bi-check2 text-sm font-bold shrink-0 mt-0.5 ${highlight ? 'text-[#0066FF]' : 'text-emerald-600'}`}></i>
        ) : (
            <i className="bi bi-lock-fill text-xs text-amber-500 shrink-0 mt-0.5"></i>
        )}
        <span className={highlight ? 'text-[#0F172A] font-bold' : included ? 'text-[#0F172A]' : 'text-[#64748B]'}>
            {text}
        </span>
    </div>
);
