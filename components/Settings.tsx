import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { auth, storage, db, messaging, type FirebaseUser } from '../firebase';
import { getToken } from 'firebase/messaging';
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
    const email = user?.email || `${userProfile.uid}@vantutor.com`;

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
          addToast(`VanTutor ${activePlan.name} activated successfully!`, 'success');
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
    const browserPermission = 'Notification' in window ? Notification.permission : 'denied';

    if (enabled) {
        // Toggling ON
        if (browserPermission === 'denied') {
            addToast("Notifications are blocked. Please enable them in browser settings.", 'error');
            setIsNotificationSaving(false);
            return;
        }

        let permission: NotificationPermission = browserPermission;
        if (browserPermission === 'default') {
            try {
                permission = await Notification.requestPermission();
            } catch (error) {
                console.error("Error requesting notification permission:", error);
                addToast("Could not request notification permission.", "error");
                setIsNotificationSaving(false);
                return;
            }
        }

        if (permission === 'granted') {
            try {
                let fcmToken = '';
                if (messaging) {
                    try {
                        fcmToken = await getToken(messaging, { vapidKey: 'BEiN-U94hIduCfay4jHxUSgVp1BEhWphsoD-1IrnZAZ2B8Zi0vJuM0Xc8-6ZrGEOibE2mXW874bT-uxoBGxQ5nY' });
                    } catch (tokenErr) {
                        console.warn("Could not retrieve FCM token:", tokenErr);
                    }
                }

                await onProfileUpdate({ notifications_enabled: true, fcm_token: fcmToken || null });
                setIsNotificationSwitchOn(true);
                addToast('Push notifications enabled!', 'success');
                
                const registration = await navigator.serviceWorker.ready;
                registration.showNotification('VANTUTOR', {
                    body: 'You will now receive important updates on your device.',
                    icon: 'data:image/svg+xml;charset=UTF-8,%3Csvg%20viewBox%3D%220%200%2052%2042%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M4.33331%2017.5L26%204.375L47.6666%2017.5L26%2030.625L4.33331%2017.5Z%22%20stroke%3D%22%2523A3E635%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M41.5%2021V29.75C41.5%2030.825%2040.85%2032.55%2039.4166%2033.25L27.75%2039.375C26.6666%2039.9%2025.3333%2039.9%2024.25%2039.375L12.5833%2033.25C11.15%2032.55%2010.5%2030.825%2010.5%2029.75V21%22%20stroke%3D%22%2523A3E635%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M47.6667%2017.5V26.25%22%20stroke%3D%22%2523A3E635%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E',
                    badge: 'data:image/svg+xml;charset=UTF-8,%3Csvg%20viewBox%3D%220%200%2052%2042%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M4.33331%2017.5L26%204.375L47.6666%2017.5L26%2030.625L4.33331%2017.5Z%22%20fill%3D%22%2523FFFFFF%22%2F%3E%3C%2Fsvg%3E'
                });
            } catch (err) {
                addToast('Failed to save notification preference.', 'error');
            }
        } else {
             addToast(permission === 'denied' ? 'Notifications have been blocked.' : 'Notifications were not enabled.', 'info');
        }
    } else {
        // Toggling OFF
        try {
            await onProfileUpdate({ notifications_enabled: false, fcm_token: null });
            setIsNotificationSwitchOn(false);
            addToast('Push notifications disabled from VANTUTOR.', 'info');
        } catch (err) {
             addToast('Failed to save notification preference.', 'error');
        }
    }
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

  const browserPermission = 'Notification' in window ? Notification.permission : 'denied';

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
                Notifications are blocked by your browser. You'll need to go into your browser's site settings for VANTUTOR to re-enable them.
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
                {userProfile.subscription_status === 'pro' && 'Pro Plan'}
                {userProfile.subscription_status === 'basic' && 'Basic Plan'}
                {(userProfile.subscription_status === 'free' || !userProfile.subscription_status) && 'Free Plan'}
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

        {/* Plan Upgrade Grid Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
          {/* Free Card */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${userProfile.subscription_status === 'free' || !userProfile.subscription_status ? 'border-blue-600 bg-blue-50/10' : 'border-gray-200'}`}>
            <div>
              <h4 className="font-extrabold text-sm text-gray-900">{usageSettings.plans.free.name || 'Free Plan'}</h4>
              <p className="text-[10px] text-gray-500 mt-1 font-semibold">{usageSettings.plans.free.description}</p>
              <ul className="text-[10px] text-gray-600 mt-3 space-y-1 font-semibold">
                <li>• {usageSettings.plans.free.limits.courses} Courses</li>
                <li>• {usageSettings.plans.free.limits.ai_requests_per_course} Requests/course (2h)</li>
                <li>• {usageSettings.plans.free.limits.exams} Practice exams</li>
                <li>• {usageSettings.plans.free.limits.visual_messages} Messages limit</li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-150">
              {userProfile.subscription_status === 'free' || !userProfile.subscription_status ? (
                <span className="text-xs text-gray-400 font-bold block">Current Plan</span>
              ) : (
                <button
                  onClick={handleSwitchToFreePlan}
                  disabled={isVerifyingKey}
                  className="w-full py-2 bg-gray-900 hover:bg-black text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all"
                >
                  Switch Free
                </button>
              )}
            </div>
          </div>

          {/* Basic Card */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${userProfile.subscription_status === 'basic' ? 'border-blue-600 bg-blue-50/10' : 'border-gray-200'}`}>
            <div>
              <h4 className="font-extrabold text-sm text-gray-900">{usageSettings.plans.basic.name || 'Basic Plan'}</h4>
              <p className="text-[10px] text-gray-500 mt-1 font-semibold">{usageSettings.plans.basic.description}</p>
              <ul className="text-[10px] text-gray-600 mt-3 space-y-1 font-semibold">
                <li>• {usageSettings.plans.basic.limits.courses} Courses</li>
                <li>• {usageSettings.plans.basic.limits.ai_requests_per_course} Requests/course (2h)</li>
                <li>• {usageSettings.plans.basic.limits.exams} Practice exams</li>
                <li>• {usageSettings.plans.basic.limits.visual_messages} Messages limit</li>
                <li className="text-blue-650 font-bold">★ Twitter Blue Badge</li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-150">
              {userProfile.subscription_status === 'basic' ? (
                <span className="text-xs text-gray-400 font-bold block">Current Plan</span>
              ) : (
                <button
                  onClick={() => handleUpgradePlan('basic')}
                  disabled={isVerifyingKey}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all"
                >
                  Buy ₦{(usageSettings.plans.basic.price || 1000).toLocaleString()}
                </button>
              )}
            </div>
          </div>

          {/* Pro Card */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${userProfile.subscription_status === 'pro' ? 'border-purple-600 bg-purple-50/10' : 'border-gray-200'}`}>
            <div>
              <h4 className="font-extrabold text-sm text-gray-900">{usageSettings.plans.pro.name || 'Pro Plan'}</h4>
              <p className="text-[10px] text-gray-500 mt-1 font-semibold">{usageSettings.plans.pro.description}</p>
              <ul className="text-[10px] text-gray-600 mt-3 space-y-1 font-semibold">
                <li>• {usageSettings.plans.pro.limits.courses} Courses</li>
                <li>• {usageSettings.plans.pro.limits.ai_requests_per_course} Requests/course (2h)</li>
                <li>• {usageSettings.plans.pro.limits.exams} Practice exams</li>
                <li>• {usageSettings.plans.pro.limits.visual_messages} Messages limit</li>
                <li className="text-purple-650 font-bold">★ Purple check badge</li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-150">
              {userProfile.subscription_status === 'pro' ? (
                <span className="text-xs text-gray-400 font-bold block">Current Plan</span>
              ) : (
                <button
                  onClick={() => handleUpgradePlan('pro')}
                  disabled={isVerifyingKey}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all"
                >
                  Buy ₦{(usageSettings.plans.pro.price || 2500).toLocaleString()}
                </button>
              )}
            </div>
          </div>

          {/* Token Card */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${userProfile.subscription_status === 'personal_token' ? 'border-emerald-600 bg-emerald-50/10' : 'border-gray-200'}`}>
            <div>
              <h4 className="font-extrabold text-sm text-gray-900">Developer Key</h4>
              <p className="text-[10px] text-gray-500 mt-1 font-semibold">Use your personal Google Gemini API key to activate and bypass all limits.</p>
              <ul className="text-[10px] text-emerald-700 mt-3 space-y-1 font-semibold">
                <li>• Unlimited Courses</li>
                <li>• Unlimited Requests</li>
                <li>• Unlimited Solves</li>
                <li>• Custom Dev Badge</li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-150">
              {userProfile.subscription_status === 'personal_token' ? (
                <span className="text-xs text-emerald-700 font-black block">Active Token</span>
              ) : (
                <button
                  onClick={() => {
                    setUsePersonalToken(true);
                  }}
                  disabled={isVerifyingKey}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all"
                >
                  Configure Key
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Developer API Key Fields (always visible or expanded if mode chosen) */}
        {(usePersonalToken || userProfile.subscription_status === 'personal_token') && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 mt-4 animate-in fade-in duration-300">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Configure Google API Token</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
              Visit the <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">Google AI Studio</a> console to copy your free API token, then paste it below.
            </p>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                placeholder="Paste Gemini API key here"
                value={personalApiKey}
                onChange={(e) => setPersonalApiKey(e.target.value)}
                className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-lg py-2 px-3 pr-10 text-gray-900 font-medium focus:outline-none transition-all font-mono text-xs shadow-sm"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-[10px] font-black"
              >
                {showApiKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            <button
              onClick={handleSaveConnectionSettings}
              disabled={isVerifyingKey || !personalApiKey.trim()}
              className="w-full py-2 bg-slate-900 hover:bg-black text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              {isVerifyingKey ? 'Verifying Key...' : 'Validate & Save Developer Token'}
            </button>
          </div>
        )}
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
        message="Are you sure? This will permanently delete your account and all associated data, including your progress, chat history, and exam results. This action cannot be undone."
        onConfirm={confirmDeletion}
        onCancel={() => setIsDeleteModalOpen(false)}
        confirmText="Yes, delete my account"
        isConfirming={isDeleting}
      />
    </div>
  );
};