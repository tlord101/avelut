import { db, equalTo, get, orderByChild, query, ref as dbRef } from '@/lib/backend';
import React, { useState, useEffect } from 'react';
import type { UserProfile, AppSettings } from '../types';
import { VerificationBadge } from './VerificationBadge';
import { DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';
import { Browser } from '@capacitor/browser';
import { isNative } from '../utils/capacitorUtils';

interface BillingSettingsProps {
  userProfile: UserProfile;
  appSettings: AppSettings;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
}

export const BillingSettingsScreen: React.FC<BillingSettingsProps> = ({ userProfile, appSettings }) => {
  const usageSettings = appSettings?.usage_settings || DEFAULT_USAGE_SETTINGS;
  const tiers = usageSettings?.tiers || (usageSettings as any)?.plans || DEFAULT_USAGE_SETTINGS.tiers;
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(true);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!userProfile.email) {
        setIsLoadingTx(false);
        return;
      }
      try {
        const fetchMatches = async (childKey: 'user_email' | 'email') => {
          const q = query(dbRef(db, 'usage_logs/payments'), orderByChild(childKey), equalTo(userProfile.email));
          const snap = await get(q);
          if (!snap.exists()) {
            return [];
          }
          return Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] }));
        };

        const primaryMatches = await fetchMatches('user_email');
        const fallbackMatches = primaryMatches.length > 0 ? [] : await fetchMatches('email');
        const list = [...primaryMatches, ...fallbackMatches].sort((a: any, b: any) => b.timestamp - a.timestamp);
        setTransactions(list);
      } catch (err) {
        console.error("Error fetching transactions:", err);
      } finally {
        setIsLoadingTx(false);
      }
    };
    fetchTransactions();
  }, [userProfile.email]);

  const handleManageBilling = async () => {
    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
    const billingUrl = `${baseUrl}/refill-credits?uid=${userProfile.uid}`;

    if (isNative()) {
      await Browser.open({ url: billingUrl });
    } else {
      window.open(billingUrl, '_blank');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-8 animate-in fade-in duration-300 max-w-6xl mx-auto">
      
      {/* Account Balance Card */}
      <div className="bg-white dark:bg-[#0F172A] border border-[#E3E9F1] dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider mb-1 block">Account Plan & Balance</span>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl sm:text-5xl font-black text-[#0F172A] dark:text-white tracking-tight">{userProfile.ai_credits_balance ?? 0}</span>
              <span className="text-sm font-bold text-[#64748B] dark:text-slate-400">Credits</span>
              <span className="text-xs font-bold px-3 py-1 bg-[#F1F5F9] dark:bg-slate-800 text-[#0066FF] rounded-full border border-[#E3E9F1] dark:border-slate-700 capitalize ml-2">
                {userProfile.subscription_status || 'Free Tier'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 mt-2 max-w-md font-medium">
              Use credits for Live Voice Tutorials (₦300/topic), flashcards (₦50/card), or subscribe to Weekly/Monthly plans for unlimited access.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 w-full md:w-auto">
            <button
              onClick={async () => {
                const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
                const url = `${baseUrl}/plans?uid=${userProfile.uid}`;
                if (isNative()) await Browser.open({ url });
                else window.open(url, '_blank');
              }}
              className="px-6 py-3 bg-[#0066FF] hover:bg-[#002D62] text-white rounded-2xl text-xs font-bold transition-all w-full md:w-auto shadow-2xs cursor-pointer active:scale-95 text-center"
            >
              View Subscription Plans
            </button>
            <button
              onClick={handleManageBilling}
              className="px-6 py-3 bg-[#F1F5F9] dark:bg-slate-800 hover:bg-[#E3E9F1] text-[#0F172A] dark:text-white rounded-2xl text-xs font-bold transition-all w-full md:w-auto border border-[#E3E9F1] dark:border-slate-700 cursor-pointer active:scale-95 text-center"
            >
              Refill Credits (₦300 Pass)
            </button>
          </div>
        </div>
      </div>



      {/* Recent Transactions */}
      <div className="bg-white dark:bg-black p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col gap-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Recent Transactions</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">Your recent payments and credit refills.</p>
        </div>
        
        {isLoadingTx ? (
           <div className="py-8 text-center text-sm text-slate-500">Loading transactions...</div>
        ) : transactions.length === 0 ? (
           <div className="py-12 flex flex-col items-center justify-center text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-white/5">
             <i className="bi bi-clock text-2xl text-slate-300 mb-3"></i>
             <p className="text-sm font-bold text-slate-600 dark:text-slate-400">No transactions yet</p>
           </div>
        ) : (
           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-slate-100 dark:border-white/10">
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Date</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Reference</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Tier</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-right">Amount</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-center">Status</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                 {transactions.slice(0, 10).map((tx) => (
                   <tr key={tx.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                     <td className="py-4 px-4 text-slate-600 dark:text-slate-400 font-medium">
                       {new Date(tx.timestamp).toLocaleDateString()}
                     </td>
                     <td className="py-4 px-4 font-mono text-xs text-slate-500">{tx.reference || 'N/A'}</td>
                     <td className="py-4 px-4 font-bold text-slate-700 dark:text-slate-300 uppercase text-xs">{tx.tier_id}</td>
                     <td className="py-4 px-4 text-right font-black text-slate-900 dark:text-white">
                       ₦{(Number(tx.amount) || 0).toLocaleString()}
                     </td>
                     <td className="py-4 px-4">
                        <div className="flex justify-center">
                          {(!tx.status || tx.status === 'success' || tx.status === 'successful') ? (
                              <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md text-[10px] font-black uppercase">
                                  <i className="bi bi-check-circle-fill text-xs"></i> Success
                              </span>
                          ) : (
                              <span className="flex items-center gap-1 text-red-600 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-md text-[10px] font-black uppercase">
                                  Failed
                              </span>
                          )}
                        </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        )}
      </div>

    </div>
  );
};
