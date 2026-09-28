import React, { useState, useEffect } from 'react';
import { DEFAULT_USAGE_SETTINGS, CANONICAL_PRICING } from '../../utils/appSettings';
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

                {/* Canonical Launch Subscription Cards: FREE vs PRO */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto pt-2">
                    
                    {/* 1. Free Plan */}
                    <div id="plan-free" className="bg-white border border-[#E3E9F1] rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#0066FF]/40 transition-all relative">
                        <div className="space-y-4">
                            <div>
                                <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                                    Starter Tier
                                </span>
                                <h3 className="text-2xl font-black text-[#0F172A] mt-0.5">Free Plan</h3>
                            </div>

                            <div className="flex items-baseline gap-1.5 pt-1">
                                <span className="text-4xl font-black text-[#0F172A]">₦0</span>
                                <span className="text-xs font-bold text-[#64748B]">/ forever</span>
                            </div>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                                Everything you need to get started with basic AI learning tools.
                            </p>

                            <div className="border-t border-[#E3E9F1] pt-5 space-y-3">
                                <FeatureItem text="AI Tutor" included />
                                <FeatureItem text="Limited AI Chat" included />
                                <FeatureItem text="Image Analysis" included />
                                <FeatureItem text="Memory" included />
                                <FeatureItem text="15 Live Tutorial minutes/month" included highlight />
                            </div>
                        </div>

                        <div className="pt-8">
                            <button
                                type="button"
                                disabled={true}
                                className="w-full py-3.5 rounded-2xl font-black text-sm bg-[#F1F5F9] text-[#64748B] cursor-default"
                            >
                                {currentStatus === 'free' || !currentStatus ? 'Current Plan' : 'Free Included'}
                            </button>
                        </div>
                    </div>

                    {/* 2. Pro Plan (Featured) */}
                    <div id="plan-pro" className="bg-white border-2 border-[#0066FF] rounded-3xl p-6 sm:p-8 shadow-lg flex flex-col justify-between relative transform md:-translate-y-1">
                        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#0066FF] text-white text-[10px] font-black uppercase tracking-wider rounded-full shadow-sm">
                            Recommended for Launch
                        </div>

                        <div className="space-y-4">
                            <div>
                                <span className="text-[11px] font-bold text-[#0066FF] uppercase tracking-wider block">
                                    Pro Membership
                                </span>
                                <h3 className="text-2xl font-black text-[#0F172A] mt-0.5">Pro Plan</h3>
                            </div>

                            <div className="flex items-baseline gap-1.5 pt-1">
                                <span className="text-4xl font-black text-[#0F172A]">₦3,999</span>
                                <span className="text-xs font-bold text-[#64748B]">/ month</span>
                            </div>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                                Complete study power package for active students needing generous live tutoring.
                            </p>

                            <div className="border-t border-[#E3E9F1] pt-5 space-y-3">
                                <FeatureItem text="AI Tutor" included />
                                <FeatureItem text="Generous AI Chat" included />
                                <FeatureItem text="Image Analysis" included />
                                <FeatureItem text="Memory" included />
                                <FeatureItem text="180 Live Tutorial minutes/month" included highlight />
                            </div>
                        </div>

                        <div className="pt-8">
                            <button
                                type="button"
                                onClick={() => handlePurchasePlan('monthly', CANONICAL_PRICING.pro.priceNgn, 2000)}
                                disabled={isProcessing || !email || currentStatus === 'monthly' || currentStatus === 'premium' || currentStatus === 'pro'}
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all cursor-pointer shadow-md active:scale-95 ${
                                    currentStatus === 'monthly' || currentStatus === 'premium' || currentStatus === 'pro'
                                        ? 'bg-[#F1F5F9] text-[#64748B] cursor-default'
                                        : 'bg-[#0066FF] hover:bg-slate-900 text-white'
                                }`}
                            >
                                {currentStatus === 'monthly' || currentStatus === 'premium' || currentStatus === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
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
                            <p className="text-[#64748B]">15 mins included per month on Free Tier. Top up credits for extra sessions.</p>
                        </div>
                    </div>
                </div>

                {/* Pay As You Go Banner */}
                <div className="bg-gradient-to-br from-[#0F172A] to-[#000000] text-white rounded-3xl p-6 sm:p-8 max-w-5xl mx-auto shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-1.5 text-center md:text-left">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#0066FF] bg-white/10 px-3 py-0.5 rounded-full inline-block">
                            Pay-As-You-Go Credits
                        </span>
                        <h4 className="text-lg sm:text-xl font-black">Need extra Live Tutorial time?</h4>
                        <p className="text-xs text-slate-300 max-w-md">
                            Buy Live Tutorial credit packages anytime: 15 min (₦299), 30 min (₦599), or 60 min (₦1,099).
                        </p>
                    </div>
                    <a
                        href="/refill-credits"
                        className="px-6 py-3 bg-white text-[#0F172A] hover:bg-[#F6F6F3] font-black text-xs sm:text-sm rounded-2xl shadow-sm active:scale-95 transition-all shrink-0 cursor-pointer"
                    >
                        Buy Credits →
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
