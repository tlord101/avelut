import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { auth, storage, db, messaging, type FirebaseUser } from '../firebase';
import { GoogleGenAI } from '@google/genai';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ref as dbRef, get } from 'firebase/database';
import { useToast } from '../hooks/useToast';
import { Avatar } from './Avatar';
import { ConfirmationModal } from './ConfirmationModal';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { VerificationBadge } from './VerificationBadge';
import { XIcon } from './icons/XIcon';
import { triggerPaystackPurchase } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';
import { DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';
import type { AppSettings } from '../types';
import { isNative } from '../utils/capacitorUtils';
import { SubscriptionCards } from './SubscriptionCards';


declare var __app_id: string;

interface SettingsProps {
  user: FirebaseUser | null;
  userProfile: UserProfile;
  appSettings: AppSettings;
  onLogout: () => void;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  onDeleteAccount: () => Promise<{ success: boolean; error?: string }>;
}

const CreditRefillCTA: React.FC<{ balance: number; onRefill: () => void; onUpgrade: () => void }> = ({ balance, onRefill, onUpgrade }) => (
  <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl overflow-hidden relative group">
    <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all duration-500" />
    <div className="relative z-10">
      <div className="flex justify-between items-start mb-6">
        <div>
          <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-1 block">Live AI Balance</span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-white tracking-tighter">{balance}</span>
            <span className="text-xs font-bold text-slate-400">Credits Available</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onRefill}
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
        >
          Refill Credits
        </button>
        <button
          onClick={onUpgrade}
          className="flex-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-slate-200 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98]"
        >
          Upgrade Plan
        </button>
      </div>
    </div>
  </div>
);

const Switch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lime-500 disabled:opacity-50 disabled:cursor-not-allowed ${
      checked ? 'bg-lime-600' : 'bg-gray-200'
    }`}
  >
    <span
      className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 ease-in-out ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

export const Settings: React.FC<SettingsProps> = ({ user, userProfile, appSettings, onLogout, onProfileUpdate, onDeleteAccount }) => {
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;
  const [isEditingName, setIsEditingName] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(userProfile.display_name);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annually'>('monthly');

  const [departmentName, setDepartmentName] = useState<string>('');
  const [isDepartmentLoading, setIsDepartmentLoading] = useState(true);
  const [levels, setLevels] = useState<string[]>([]);
  const [isLevelsLoading, setIsLevelsLoading] = useState(true);
  const [isNotificationSwitchOn, setIsNotificationSwitchOn] = useState(userProfile.notifications_enabled);
  const [isNotificationSaving, setIsNotificationSaving] = useState(false);
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefillModalOpen, setIsRefillModalOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);

  useEffect(() => {
    setIsNotificationSwitchOn(userProfile.notifications_enabled);
  }, [userProfile.notifications_enabled]);

  useEffect(() => {
    const fetchDepartmentData = async () => {
      if (!userProfile.department_id) {
        setDepartmentName('Not Set');
        setIsDepartmentLoading(false);
        setIsLevelsLoading(false);
        return;
      }
      setIsDepartmentLoading(true);
      setIsLevelsLoading(true);
      try {
        const snapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
        const departmentData = snapshot.val();

        if (departmentData) {
          setDepartmentName(departmentData.department_name || userProfile.department_id.replace(/_/g, ' '));
          setLevels(departmentData.levels || []);
        } else {
          setDepartmentName(userProfile.department_id.replace(/_/g, ' '));
          setLevels([]);
        }
      } catch (error) {
        console.error("Failed to fetch department data:", error);
        setDepartmentName(userProfile.department_id.replace(/_/g, ' '));
        setLevels([]);
        addToast("Could not load department details.", "error");
      } finally {
        setIsDepartmentLoading(false);
        setIsLevelsLoading(false);
      }
    };

    fetchDepartmentData();
  }, [userProfile.department_id, addToast]);
  
  const handleNotificationToggle = async (enabled: boolean) => {
    setIsNotificationSaving(true);
    
    if (isNative()) {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        if (enabled) {
          const permResult = await PushNotifications.requestPermissions();
          if (permResult.receive === 'granted') {
            await PushNotifications.register();
            await onProfileUpdate({ notifications_enabled: true });
            setIsNotificationSwitchOn(true);
            addToast('Push notifications enabled!', 'success');
          } else {
            addToast('Permission denied for push notifications.', 'error');
          }
        } else {
          await onProfileUpdate({ notifications_enabled: false });
          setIsNotificationSwitchOn(false);
          addToast('Push notifications disabled from AVELUT.', 'info');
        }
      } catch (err) {
        console.error(err);
        addToast('Failed to update notification settings.', 'error');
      } finally {
        setIsNotificationSaving(false);
      }
      return;
    }

    addToast('Push notifications are only supported in the native mobile app.', 'info');
    setIsNotificationSaving(false);
  };


  const handleSaveName = async () => {
    if (newDisplayName.trim() === '' || newDisplayName.trim() === userProfile.display_name) {
      setIsEditingName(false);
      setNewDisplayName(userProfile.display_name);
      return;
    }
    setIsSaving(true);
    const result = await onProfileUpdate({ display_name: newDisplayName.trim() });
    if (result.success) {
      setIsEditingName(false);
      addToast('Display name updated successfully!', 'success');
    } else {
      addToast(result.error || "Failed to save new display name.", 'error');
    }
    setIsSaving(false);
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setNewDisplayName(userProfile.display_name);
  };

  const handleLevelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLevel = e.target.value;
    setIsSaving(true);
    const result = await onProfileUpdate({ level: newLevel });
    if (result.success) {
      addToast('Level updated successfully!', 'success');
    } else {
      addToast(result.error || "Failed to save new level.", 'error');
      e.target.value = userProfile.level;
    }
    setIsSaving(false);
  };
  
    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !user) return;

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            addToast("File is too large. Please select an image under 5MB.", "error");
            return;
        }

        setIsSaving(true);
        try {
            const avatarRef = storageRef(storage, `profile-pictures/${user.uid}`);
            const uploadResult = await uploadBytes(avatarRef, file);
            const downloadURL = await getDownloadURL(uploadResult.ref);
            const cacheBustURL = `${downloadURL}&t=${new Date().getTime()}`;
            const result = await onProfileUpdate({ photo_url: cacheBustURL });
            if (result.success) {
                addToast("Profile picture updated!", "success");
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error("Failed to upload profile picture:", error);
            addToast("Could not update profile picture.", "error");
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemovePhoto = async () => {
        if (!user || !userProfile.photo_url) return;
        setIsSaving(true);
        try {
            const result = await onProfileUpdate({ photo_url: "" });
             if (result.success) {
                addToast("Profile picture removed.", "success");
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error("Failed to remove profile picture:", error);
            addToast("Could not remove profile picture.", "error");
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDeletion = async () => {
      setIsDeleting(true);
      const result = await onDeleteAccount();
      if (!result.success) {
          addToast(result.error || 'Failed to delete account.', 'error');
          setIsDeleting(false);
          setIsDeleteModalOpen(false);
      }
    };

  const handleSwitchToFreePlan = async () => {
    setIsVerifyingKey(true);
    try {
      const result = await onProfileUpdate({
        is_activated: true,
        subscription_status: 'free',
        use_personal_token: false,
      });
      if (result.success) {
        addToast('Switched to Free Plan successfully!', 'success');
      } else {
        addToast('Failed to switch plan.', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Error switching plan.', 'error');
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleUpgradePlan = async (planKey: any) => {
    const activePlan = (usageSettings.plans as any)[planKey];
    const amount = activePlan.price;
    const publicKey = appSettings.paystack_public_key?.trim();
    const email = user?.email || `${userProfile.uid}@avelut.com`;

    setIsVerifyingKey(true);

    await triggerPaystackPurchase({
      publicKey,
      email,
      amount,
      userId: userProfile.uid,
      purchaseType: 'subscription',
      metadata: { plan_tier: planKey, upgrade: true },
      addToast,
      onSuccess: async (reference) => {
        const result = await onProfileUpdate({
          is_activated: true,
          subscription_status: planKey,
          use_personal_token: false,
          paystack_reference: reference,
        });
        if (result.success) {
          addToast(`AVELUT ${activePlan.name} activated successfully!`, 'success');
        } else {
          addToast('Payment received but upgrade failed. Contact support.', 'error');
        }
        setIsVerifyingKey(false);
      },
      onCancel: () => {
        setIsVerifyingKey(false);
      },
      onError: (err) => {
        console.error(err);
        setIsVerifyingKey(false);
      }
    });
  };

  const browserPermission = isNative() ? 'granted' : ('Notification' in window ? Notification.permission : 'denied');

  return (
    <div className="p-4 sm:p-6 space-y-8">
      {/* Unified Credit Balance Display at absolute top */}
      <CreditRefillCTA
        balance={userProfile.ai_credits_balance ?? 0}
        onRefill={() => setIsRefillModalOpen(true)}
        onUpgrade={() => setIsSubscriptionModalOpen(true)}
      />

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Information</h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Display Name</span>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="bg-gray-50 border border-gray-300 rounded-md py-1 px-2 text-gray-900 font-medium focus:ring-1 focus:ring-lime-500 focus:outline-none"
                  disabled={isSaving}
                />
                <button onClick={handleSaveName} disabled={isSaving || newDisplayName.trim() === ''} className="text-sm font-semibold text-lime-600 hover:text-lime-500 disabled:opacity-50">
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={handleCancelEdit} disabled={isSaving} className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-gray-800 font-medium">{userProfile.display_name}</span>
                <VerificationBadge status={userProfile.subscription_status} />
                <button onClick={() => setIsEditingName(true)} className="ml-2 text-sm text-lime-600 hover:underline">
                  Edit
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center border-t border-gray-200 pt-4">
            <span className="text-gray-600">Email</span>
            <span className="text-gray-800 font-medium">{user?.email}</span>
          </div>
           <div className="flex justify-between items-center border-t border-gray-200 pt-4">
            <span className="text-gray-600">Current Department</span>
            <span className="text-gray-800 font-medium">{isDepartmentLoading ? 'Loading...' : departmentName}</span>
          </div>
           <div className="flex justify-between items-center border-t border-gray-200 pt-4">
            <span className="text-gray-600">Level</span>
             {isLevelsLoading ? (
                <span className="text-gray-500 text-sm">Loading levels...</span>
            ) : (
                <select
                    value={userProfile.level}
                    onChange={handleLevelChange}
                    disabled={isSaving || levels.length === 0}
                    className="bg-gray-50 border border-gray-300 rounded-md py-1 px-2 text-gray-900 font-medium focus:ring-1 focus:ring-lime-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Change difficulty level"
                >
                    {levels.length > 0 ? (
                      levels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))
                    ) : (
                      <option value={userProfile.level} disabled>{userProfile.level}</option>
                    )}
                </select>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Picture</h3>
        <div className="flex items-center gap-4">
            <Avatar display_name={userProfile.display_name} photo_url={userProfile.photo_url} className="w-16 h-16" />
            <div className="flex flex-col gap-2">
                <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                    {isSaving ? 'Uploading...' : 'Upload Picture'}
                </button>
                {userProfile.photo_url && (
                    <button
                        onClick={handleRemovePhoto}
                        disabled={isSaving}
                        className="text-sm text-red-600 hover:underline disabled:opacity-50"
                    >
                        Remove
                    </button>
                )}
            </div>
        </div>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Notifications</h3>
        <div className="flex justify-between items-center">
            <div>
                <span className="text-gray-600">Enable Push Notifications</span>
                 <p className="text-xs text-gray-500 mt-1">
                    Get reminders and progress updates.
                </p>
            </div>
            <Switch 
                checked={isNotificationSwitchOn} 
                onChange={handleNotificationToggle}
                disabled={isNotificationSaving}
            />
        </div>
      </div>

      <div id="subscription-status" className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Subscription & Status</h3>
        <p className="text-xs text-gray-500 mb-6 font-semibold">
          Current account active tier information.
        </p>

        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center">
          <div>
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">Current Status</span>
            <div className="flex items-center gap-2 mt-1">
              <h4 className="font-extrabold text-slate-900 text-sm">
                {userProfile.subscription_status === 'pro' && (usageSettings.plans.pro.name || 'Pro Plan')}
                {userProfile.subscription_status === 'basic' && (usageSettings.plans.basic.name || 'Basic Plan')}
                {(userProfile.subscription_status === 'free' || !userProfile.subscription_status) && (usageSettings.plans.free.name || 'Free Plan')}
                {userProfile.subscription_status === 'personal_token' && 'Personal Google Token'}
                {userProfile.subscription_status === 'premium' && 'Premium Plan'}
              </h4>
              <VerificationBadge status={userProfile.subscription_status || 'free'} />
            </div>
          </div>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 shadow-sm">
            Active Tier
          </span>
        </div>

        <button
          onClick={() => setIsSubscriptionModalOpen(true)}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-md active:scale-95"
        >
          View All Subscription Plans
        </button>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Account Actions</h3>
         <div className="divide-y divide-gray-200">
           <button
              onClick={onLogout}
              className="w-full text-left p-3 text-gray-700 font-medium hover:bg-gray-100 transition-colors duration-200"
            >
              Logout
            </button>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="w-full text-left p-3 text-red-600 font-medium hover:bg-red-50 transition-colors duration-200"
            >
              Delete Account
            </button>
         </div>
      </div>

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        title="Delete Account"
        message="Are you sure? This will permanently delete your account and all associated data."
        onConfirm={confirmDeletion}
        onCancel={() => setIsDeleteModalOpen(false)}
        confirmText="Yes, delete my account"
        isConfirming={isDeleting}
      />

      <LimitExceededModal
        isOpen={isRefillModalOpen}
        onClose={() => setIsRefillModalOpen(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={0}
        balance={userProfile.ai_credits_balance ?? 0}
        addToast={addToast}
        onSuccessPurchase={() => {}}
      />

      {/* Subscription Plans Modal */}
      {isSubscriptionModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            onClick={() => setIsSubscriptionModalOpen(false)}
          />
          <div className="relative w-full max-w-5xl bg-white border border-slate-200 rounded-[28px] shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh] overflow-hidden">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-slate-900 leading-tight">Subscription Plans</h3>
                <p className="text-xs text-slate-500 mt-1 font-semibold text-left">Upgrade your tier to unlock more monthly AI credits.</p>
              </div>
              <button
                onClick={() => setIsSubscriptionModalOpen(false)}
                className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-450 hover:text-red-500 hover:border-red-100 transition-all shadow-sm active:scale-95"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="max-w-4xl mx-auto">
                <SubscriptionCards
                  userProfile={userProfile}
                  appSettings={appSettings}
                  onSelectPlan={(planKey, options) => {
                    if (planKey === 'free') {
                      handleSwitchToFreePlan();
                    } else if (planKey === 'personal_token') {
                      // Handled within SubscriptionCards or requires additional logic here if passing personal token
                    } else {
                      handleUpgradePlan(planKey);
                    }
                  }}
                  isVerifyingKey={isVerifyingKey}
                  showCurrentPlan={true}
                />
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 bg-slate-50/50 text-center shrink-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secure checkout via Paystack</p>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
