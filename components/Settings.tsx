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
import { triggerPaystackPurchase } from '../utils/usage';
import { DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';
import type { AppSettings } from '../types';
import { isNative } from '../utils/capacitorUtils';


declare var __app_id: string;

interface SettingsProps {
  user: FirebaseUser | null;
  userProfile: UserProfile;
  appSettings: AppSettings;
  onLogout: () => void;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  onDeleteAccount: () => Promise<{ success: boolean; error?: string }>;
}

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
  // FIX: Use snake_case for display_name
  const [newDisplayName, setNewDisplayName] = useState(userProfile.display_name);
  const [isSaving, setIsSaving] = useState(false);
  const [usePersonalToken, setUsePersonalToken] = useState(userProfile.use_personal_token || false);
  const [personalApiKey, setPersonalApiKey] = useState(userProfile.personal_api_key || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annually'>('monthly');

  useEffect(() => {
    setUsePersonalToken(userProfile.use_personal_token || false);
    setPersonalApiKey(userProfile.personal_api_key || '');
  }, [userProfile.use_personal_token, userProfile.personal_api_key]);

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

  const handleUpgradePlan = async (planKey: 'basic' | 'pro') => {
    const activePlan = usageSettings.plans[planKey];
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

  const handleSaveConnectionSettings = async () => {
    if (!personalApiKey.trim()) {
      addToast('Please enter a valid Gemini API Key.', 'error');
      return;
    }
    setIsVerifyingKey(true);
    try {
      const testClient = new GoogleGenAI({ apiKey: personalApiKey.trim() });
      const response = await testClient.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: 'Hello, this is a test.' }] }]
      });
      if (!response.text) {
        throw new Error('Key validation failed: Empty response.');
      }
      const result = await onProfileUpdate({
        use_personal_token: true,
        personal_api_key: personalApiKey.trim(),
        subscription_status: 'personal_token',
        is_activated: true
      });
      if (result.success) {
        addToast('Personal API Key successfully verified and saved!', 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (e: any) {
      console.error(e);
      addToast('Invalid API Key. Please verify and try again.', 'error');
    } finally {
      setIsVerifyingKey(false);
    }
  };

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
    // FIX: Use snake_case for display_name
    if (newDisplayName.trim() === '' || newDisplayName.trim() === userProfile.display_name) {
      setIsEditingName(false);
      setNewDisplayName(userProfile.display_name);
      return;
    }
    setIsSaving(true);
    // FIX: Use snake_case for display_name
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
    // FIX: Use snake_case for display_name
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
      // Revert select to original value on failure
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
            
            // Add a timestamp to bust cache for updated images
            const cacheBustURL = `${downloadURL}&t=${new Date().getTime()}`;

            // FIX: Use snake_case for photo_url
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
        // FIX: Use snake_case for photo_url
        if (!user || !userProfile.photo_url) return;
        setIsSaving(true);
        try {
            // FIX: Use snake_case for photo_url
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
      // On success, the App component will handle the user state change and redirect.
    };

  const browserPermission = isNative() ? 'granted' : ('Notification' in window ? Notification.permission : 'denied');

  return (
    <div className="p-4 sm:p-6 space-y-8">
      
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
                {/* FIX: Use snake_case for display_name */}
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
          <div className="flex justify-between items-center border-t border-gray-200 pt-4">
            <span className="text-gray-600">Default Study Guide Semester</span>
            <select
                value={userProfile.default_semester_tab || 'all'}
                onChange={async (e) => {
                  const newDefaultTab = e.target.value;
                  setIsSaving(true);
                  const result = await onProfileUpdate({ default_semester_tab: newDefaultTab });
                  if (result.success) {
                    addToast('Default semester preference saved!', 'success');
                  } else {
                    addToast(result.error || 'Failed to save preference.', 'error');
                    e.target.value = userProfile.default_semester_tab || 'all';
                  }
                  setIsSaving(false);
                }}
                disabled={isSaving}
                className="bg-gray-50 border border-gray-300 rounded-md py-1 px-2 text-gray-900 font-medium focus:ring-1 focus:ring-lime-500 focus:outline-none disabled:opacity-50"
                aria-label="Change default study guide semester"
            >
              <option value="all">All / Both Semesters</option>
              <option value="first">1st Semester</option>
              <option value="second">2nd Semester</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Picture</h3>
        <div className="flex items-center gap-4">
            {/* FIX: Use snake_case for display_name and photo_url */}
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
                {/* FIX: Use snake_case for photo_url */}
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
        {browserPermission === 'denied' && (
            <p className="text-xs text-yellow-700 mt-3 p-2 bg-yellow-50 rounded-md border border-yellow-200">
                Notifications are blocked by your browser. You'll need to go into your browser's site settings for AVELUT to re-enable them.
            </p>
        )}
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Subscription & Plans</h3>
        <p className="text-xs text-gray-500 mb-6 font-semibold">
          Manage your account subscription plan. Upgrade or connect your own API key to bypass limits.
        </p>

        {/* Current active plan callout */}
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

        {/* Toggle Billing Period */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-100 p-1 rounded-full inline-flex border border-gray-200">
            <button
              type="button"
              onClick={() => setBillingInterval('monthly')}
              className={`px-6 py-1.5 rounded-full text-xs font-black transition-all ${
                billingInterval === 'monthly'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval('annually')}
              className={`px-6 py-1.5 rounded-full text-xs font-black transition-all ${
                billingInterval === 'annually'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Annually
            </button>
          </div>
        </div>

        {/* Plan Upgrade Grid Cards */}
        <div className="flex overflow-x-auto snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden gap-6 mb-6 pb-4 md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-x-visible md:pb-0 scroll-smooth">
          
          {/* Card 1: Forever Free */}
          <div className={`w-[85vw] max-w-[320px] shrink-0 snap-center md:w-auto md:max-w-none md:shrink rounded-[24px] border p-6 flex flex-col justify-between transition-all relative ${
            userProfile.subscription_status === 'free' || !userProfile.subscription_status 
              ? 'border-blue-500 bg-white shadow-lg' 
              : 'border-slate-200 bg-white'
          }`}>
            <div className="flex flex-col flex-grow">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5BBFFF] to-[#0070B8] flex items-center justify-center text-white mb-6 shadow-sm">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 12 20 22 4 22 4 12" />
                  <rect x="2" y="7" width="20" height="5" rx="1" />
                  <line x1="12" y1="22" x2="12" y2="7" />
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                </svg>
              </div>
              <h4 className="font-extrabold text-xl text-slate-900 leading-tight">
                {usageSettings.plans.free.name || 'Forever Free'}
              </h4>
              <p className="text-sm text-slate-500 mt-2 font-semibold leading-snug min-h-[40px]">
                {usageSettings.plans.free.description || "Perfect if you're just getting started with your study promotion."}
              </p>
              <div className="flex items-baseline gap-1.5 mt-5 mb-5">
                <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  ₦{usageSettings.plans.free.price}
                </span>
                <span className="text-slate-500 font-bold text-sm">Free</span>
              </div>
              
              {userProfile.subscription_status === 'free' || !userProfile.subscription_status ? (
                <span className="w-full text-center py-3 bg-slate-50 text-slate-400 text-sm font-bold rounded-xl block border border-slate-200 mb-6">Current Plan</span>
              ) : (
                <button
                  onClick={handleSwitchToFreePlan}
                  disabled={isVerifyingKey}
                  className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 text-sm font-bold rounded-xl transition-all shadow-sm active:scale-[0.98] mb-6"
                >
                  Subscribe
                </button>
              )}
              
              <ul className="text-xs text-slate-600 space-y-3 font-semibold text-left">
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.free.limits.courses === -1 ? 'Unlimited Courses' : `${usageSettings.plans.free.limits.courses} Courses limit`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.free.limits.ai_requests_per_course === -1 ? 'Unlimited AI requests' : `${usageSettings.plans.free.limits.ai_requests_per_course} AI requests per course`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.free.limits.exams === -1 ? 'Unlimited Exam generations' : `${usageSettings.plans.free.limits.exams} Exam generations`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.free.limits.visual_messages === -1 ? 'Unlimited OCR Solver scans' : `${usageSettings.plans.free.limits.visual_messages} OCR Solver scans`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Standard AI Tutoring</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Card 2: Professional (Basic Plan) */}
          <div className={`w-[85vw] max-w-[320px] shrink-0 snap-center md:w-auto md:max-w-none md:shrink rounded-[24px] border-2 flex flex-col justify-between transition-all relative overflow-hidden p-6 pt-12 ${
            userProfile.subscription_status === 'basic' 
              ? 'border-blue-650 bg-white shadow-xl' 
              : 'border-blue-600 bg-white'
          }`}>
            <div className="absolute top-0 left-0 right-0 bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest text-center py-2">
              Most Popular
            </div>
            
            <div className="flex flex-col flex-grow">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FF4E98] to-[#FF8E53] flex items-center justify-center text-white mb-6 shadow-sm">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="7" />
                  <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                </svg>
              </div>
              <h4 className="font-extrabold text-xl text-slate-900 leading-tight">
                {usageSettings.plans.basic.name || 'Professional'}
              </h4>
              <p className="text-sm text-slate-500 mt-2 font-semibold leading-snug min-h-[40px]">
                {usageSettings.plans.basic.description || "Take your study promotion to the next level with more features."}
              </p>
              <div className="flex items-baseline gap-1.5 mt-5 mb-5">
                <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  ₦{billingInterval === 'monthly' ? usageSettings.plans.basic.price : Math.round(usageSettings.plans.basic.price * 0.75)}
                </span>
                <span className="text-slate-500 font-bold text-sm">/month</span>
              </div>
              
              {userProfile.subscription_status === 'basic' ? (
                <span className="w-full text-center py-3 bg-blue-50 text-blue-600 text-sm font-bold rounded-xl block border border-blue-200 mb-6">Current Plan</span>
              ) : (
                <button
                  onClick={() => handleUpgradePlan('basic')}
                  disabled={isVerifyingKey}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-blue-500/25 active:scale-[0.98] mb-6"
                >
                  Subscribe
                </button>
              )}
              
              <ul className="text-xs text-slate-600 space-y-3 font-semibold text-left">
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.basic.limits.courses === -1 ? 'Unlimited Courses' : `${usageSettings.plans.basic.limits.courses} Courses limit`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.basic.limits.ai_requests_per_course === -1 ? 'Unlimited AI requests' : `${usageSettings.plans.basic.limits.ai_requests_per_course} AI requests per course`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.basic.limits.exams === -1 ? 'Unlimited Exam generations' : `${usageSettings.plans.basic.limits.exams} Exam generations`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.basic.limits.visual_messages === -1 ? 'Unlimited OCR Solver scans' : `${usageSettings.plans.basic.limits.visual_messages} OCR Solver scans`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Blue Verification Badge</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Card 3: Advanced (Pro Plan) */}
          <div className={`w-[85vw] max-w-[320px] shrink-0 snap-center md:w-auto md:max-w-none md:shrink rounded-[24px] border p-6 flex flex-col justify-between transition-all relative ${
            userProfile.subscription_status === 'pro' 
              ? 'border-blue-500 bg-white shadow-lg' 
              : 'border-slate-200 bg-white'
          }`}>
            <div className="flex flex-col flex-grow">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FFB000] to-[#FF6B00] flex items-center justify-center text-white mb-6 shadow-sm">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h12l4 6-10 13L2 9z" />
                  <path d="M11 3 8 9l4 13 4-13-3-6" />
                  <path d="M2 9h20" />
                </svg>
              </div>
              <h4 className="font-extrabold text-xl text-slate-900 leading-tight">
                {usageSettings.plans.pro.name || 'Advanced'}
              </h4>
              <p className="text-sm text-slate-500 mt-2 font-semibold leading-snug min-h-[40px]">
                {usageSettings.plans.pro.description || "Completely automate your learning progress with maximum options."}
              </p>
              <div className="flex items-baseline gap-1.5 mt-5 mb-5">
                <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  ₦{billingInterval === 'monthly' ? usageSettings.plans.pro.price : Math.round(usageSettings.plans.pro.price * 0.75)}
                </span>
                <span className="text-slate-500 font-bold text-sm">/month</span>
              </div>
              
              {userProfile.subscription_status === 'pro' ? (
                <span className="w-full text-center py-3 bg-slate-50 text-slate-400 text-sm font-bold rounded-xl block border border-slate-200 mb-6">Current Plan</span>
              ) : (
                <button
                  onClick={() => handleUpgradePlan('pro')}
                  disabled={isVerifyingKey}
                  className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 text-sm font-bold rounded-xl transition-all shadow-sm active:scale-[0.98] mb-6"
                >
                  Subscribe
                </button>
              )}
              
              <ul className="text-xs text-slate-600 space-y-3 font-semibold text-left">
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.pro.limits.courses === -1 ? 'Unlimited Courses' : `${usageSettings.plans.pro.limits.courses} Courses limit`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.pro.limits.ai_requests_per_course === -1 ? 'Unlimited AI requests' : `${usageSettings.plans.pro.limits.ai_requests_per_course} AI requests per course`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.pro.limits.exams === -1 ? 'Unlimited Exam generations' : `${usageSettings.plans.pro.limits.exams} Exam generations`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>{usageSettings.plans.pro.limits.visual_messages === -1 ? 'Unlimited OCR Solver scans' : `${usageSettings.plans.pro.limits.visual_messages} OCR Solver scans`}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Purple Verification Badge</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Card 4: Developer Key */}
          <div className={`w-[85vw] max-w-[320px] shrink-0 snap-center md:w-auto md:max-w-none md:shrink rounded-[24px] border p-6 flex flex-col justify-between transition-all relative ${
            userProfile.subscription_status === 'personal_token' 
              ? 'border-emerald-600 bg-white shadow-lg' 
              : 'border-slate-200 bg-white'
          }`}>
            <div className="flex flex-col flex-grow">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center text-white mb-6 shadow-sm">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <h4 className="font-extrabold text-xl text-slate-900 leading-tight">Developer Key</h4>
              <p className="text-sm text-slate-500 mt-2 font-semibold leading-snug min-h-[40px]">
                Use your personal Google Gemini API key to activate and bypass all limits.
              </p>
              <div className="flex items-baseline gap-1.5 mt-5 mb-5">
                <span className="text-4xl font-extrabold text-emerald-600 tracking-tight">Dev</span>
                <span className="text-slate-500 font-bold text-sm">Token</span>
              </div>
              
              <div className="mb-6">
                {(usePersonalToken || userProfile.subscription_status === 'personal_token') ? (
                  <div className="space-y-2 text-left">
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="Paste Gemini API key"
                        value={personalApiKey}
                        onChange={(e) => setPersonalApiKey(e.target.value)}
                        className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-lg py-2 px-3 pr-10 text-slate-800 font-medium focus:outline-none transition-all font-mono text-[11px] shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs font-bold"
                      >
                        {showApiKey ? 'HIDE' : 'SHOW'}
                      </button>
                    </div>
                    <button
                      onClick={handleSaveConnectionSettings}
                      disabled={isVerifyingKey || !personalApiKey.trim()}
                      className="w-full py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    >
                      {isVerifyingKey ? 'Saving...' : 'Save Token'}
                    </button>
                    {userProfile.subscription_status === 'personal_token' && (
                      <span className="text-[11px] text-emerald-650 font-bold block text-center mt-1">✓ Active Token</span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setUsePersonalToken(true)}
                    disabled={isVerifyingKey}
                    className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 text-sm font-bold rounded-xl transition-all active:scale-[0.98] shadow-sm mb-6"
                  >
                    Configure Personal Token
                  </button>
                )}
              </div>
              
              <ul className="text-xs text-slate-600 space-y-3 font-semibold text-left">
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Unlimited Courses</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Unlimited Requests</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Unlimited Solves</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="8 12 11 15 16 9" />
                  </svg>
                  <span>Custom Dev Badge</span>
                </li>
              </ul>
            </div>
          </div>

        </div>  </div>

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
        message="Are you sure? This will permanently delete your account and all associated data, including your progress, chat history, and exam results. This action cannot be undone."
        onConfirm={confirmDeletion}
        onCancel={() => setIsDeleteModalOpen(false)}
        confirmText="Yes, delete my account"
        isConfirming={isDeleting}
      />
    </div>
  );
};