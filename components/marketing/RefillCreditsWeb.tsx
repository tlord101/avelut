import React, { useState } from 'react';
import type { AppSettings, UserProfile } from '../../types';
import { triggerPaystackPurchase } from '../../utils/usage';
import { useToast } from '../../hooks/useToast';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { saveLocalCredits } from '../../services/creditsStorageService';

interface RefillCreditsWebProps {
    appSettings: AppSettings;
    userProfile?: UserProfile;
}

export const RefillCreditsWeb: React.FC<RefillCreditsWebProps> = ({ appSettings, userProfile }) => {
    const [customAmount, setCustomAmount] = useState<string>('');
    const [email, setEmail] = useState<string>(userProfile?.email || '');
    const [isProcessing, setIsProcessing] = useState(false);
    const { addToast } = useToast();

    const quickPacks = [
        {
            title: '1 Live Voice Tutorial Pass',
            amount: 150,
            description: 'Unlocks 1 full 15-min interactive live blackboard voice tutorial (150 credits).',
            badge: '15 Mins',
            icon: 'bi-broadcast',
        },
        {
            title: '3 Live Tutorials Bundle',
            amount: 400,
            description: '3 full topic live tutorial passes (save ₦50 on bundle).',
            badge: 'Best Value',
            icon: 'bi-collection-play',
        },
        {
            title: 'Study Boost (500 Credits)',
            amount: 500,
            description: '500 credits for live lessons, AI chat, quizzes, flashcards & camera solves.',
            badge: 'Popular',
            icon: 'bi-lightning-charge',
        },
    ];

    const handlePurchaseCredits = async (amount: number, label?: string) => {
        const searchParams = new URLSearchParams(window.location.search);
        const targetUid = userProfile?.uid || searchParams.get('uid');
        const emailFromParam = searchParams.get('email');
        const finalEmail = email || emailFromParam || userProfile?.email;

        if (!targetUid) {
            alert("Please log in to purchase credits.");
            return;
        }
        if (amount < 100) {
            alert("Minimum amount is ₦100");
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
                amount: amount,
                userId: targetUid,
                purchaseType: 'additional_credits',
                metadata: { credit_amount: amount, pack_label: label || 'Refill Credits' },
                addToast,
                onSuccess: async (reference) => {
                    try {
                        let newBal = (userProfile?.ai_credits || 0) + amount;
                        if (isSupabaseConfigured && targetUid) {
                            const { data: rpcRes } = await supabase.rpc('increment_user_credits', {
                                p_user_id: targetUid,
                                p_amount: amount,
                            });
                            if (rpcRes?.credits) {
                                newBal = rpcRes.credits;
                            } else {
                                const { data: prof } = await supabase.from('profiles').select('ai_credits').eq('id', targetUid).maybeSingle();
                                newBal = (prof?.ai_credits || 0) + amount;
                                await supabase.from('profiles').update({ ai_credits: newBal, updated_at: new Date().toISOString() }).eq('id', targetUid);
                            }
                        }
                        saveLocalCredits(targetUid, newBal, userProfile?.subscription_status || 'free').catch(console.warn);

                        try {
                            await fetch('/api/paystack-verify', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reference, userId: targetUid }),
                            });
                        } catch (fnErr) {
                            console.warn('[RefillCreditsWeb] Cloud verification notice:', fnErr);
                        }

                        addToast(`Payment successful! ${amount.toLocaleString()} credits added.`, 'success');
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

    return (
        <div className="min-h-screen bg-[#F6F6F3] text-[#0F172A] font-sans pb-28">
            {/* Header */}
            <header className="bg-white border-b border-[#E3E9F1] sticky top-0 z-50 shadow-2xs">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <a href="/" className="flex items-center gap-3">
                        <img src="/logo_icon.png" alt="AVELUT" className="w-8 h-8 object-contain" />
                        <span className="text-lg font-black tracking-tight text-[#0F172A]">
                            AVELUT <span className="text-[#0066FF] font-extrabold">Pay-As-You-Go</span>
                        </span>
                    </a>
                    <a
                        href="/plans"
                        className="text-xs font-bold text-[#0066FF] hover:text-[#0F172A] bg-[#F1F5F9] px-3.5 py-1.5 rounded-full border border-[#E3E9F1] transition-colors"
                    >
                        View Weekly / Monthly Plans →
                    </a>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-10 animate-fade-in">
                {/* Hero Title */}
                <div className="text-center max-w-2xl mx-auto space-y-3">
                    <span className="text-[11px] font-black uppercase tracking-widest text-[#0066FF] bg-[#F1F5F9] px-3.5 py-1 rounded-full border border-[#E3E9F1]">
                        Credit Refills & Passes
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-black text-[#0F172A] tracking-tight">
                        Pay As You Learn
                    </h1>
                    <p className="text-sm sm:text-base text-[#64748B] font-medium leading-relaxed">
                        Purchase single topic Live Voice Tutorial passes (₦300/topic) or extra flashcard credits (₦50/flashcard) without a recurring subscription.
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

                {/* Quick Credit Packs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {quickPacks.map((pack) => (
                        <div
                            key={pack.amount}
                            className="bg-white border border-[#E3E9F1] rounded-3xl p-6 shadow-xs flex flex-col justify-between hover:border-[#0066FF]/50 transition-all group"
                        >
                            <div className="space-y-3.5">
                                <div className="flex items-center justify-between">
                                    <div className="w-10 h-10 rounded-2xl bg-[#F1F5F9] border border-[#E3E9F1] flex items-center justify-center text-[#0066FF] text-lg font-bold group-hover:bg-[#0066FF] group-hover:text-white transition-colors shadow-2xs">
                                        <i className={`bi ${pack.icon}`}></i>
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 bg-[#F1F5F9] text-[#64748B] rounded-full border border-[#E3E9F1]">
                                        {pack.badge}
                                    </span>
                                </div>

                                <div>
                                    <h3 className="text-base font-black text-[#0F172A] group-hover:text-[#0066FF] transition-colors">
                                        {pack.title}
                                    </h3>
                                    <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                                        {pack.description}
                                    </p>
                                </div>

                                <div className="text-2xl font-black text-[#0F172A] pt-1">
                                    ₦{pack.amount.toLocaleString()}
                                </div>
                            </div>

                            <div className="pt-5">
                                <button
                                    type="button"
                                    onClick={() => handlePurchaseCredits(pack.amount, pack.title)}
                                    disabled={isProcessing || !email}
                                    className="w-full py-3 bg-[#0066FF] hover:bg-slate-900 disabled:opacity-50 text-white rounded-2xl font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95"
                                >
                                    Purchase Pass
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Custom Amount Form */}
                <div className="bg-white border border-[#E3E9F1] rounded-3xl p-6 sm:p-7 shadow-xs max-w-xl mx-auto space-y-4">
                    <div>
                        <h4 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">
                            Custom Credit Refill
                        </h4>
                        <p className="text-xs text-[#64748B] mt-0.5">
                            Enter any custom amount to top up your balance (min ₦100).
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-sm text-[#64748B]">₦</span>
                            <input
                                type="number"
                                min="100"
                                step="50"
                                value={customAmount}
                                onChange={(e) => setCustomAmount(e.target.value)}
                                placeholder="500"
                                className="w-full pl-8 pr-4 py-3 bg-[#F6F6F3] border border-[#E3E9F1] rounded-2xl font-bold text-sm text-[#0F172A] focus:ring-2 focus:ring-[#0066FF] focus:border-transparent outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const val = parseInt(customAmount, 10);
                                if (isNaN(val) || val < 100) {
                                    alert("Please enter a valid amount of at least ₦100");
                                    return;
                                }
                                void handlePurchaseCredits(val, `Custom Refill ₦${val}`);
                            }}
                            disabled={isProcessing || !email || !customAmount}
                            className="px-6 py-3 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white rounded-2xl font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                        >
                            Top Up
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
};
