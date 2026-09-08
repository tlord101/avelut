import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { supabaseAuthService } from '../services/supabaseAuthService';
import { useToast } from '../hooks/useToast';
import { ConfirmationModal } from './ConfirmationModal';
import { isNative } from '../utils/capacitorUtils';
import { useTheme } from '../contexts/ThemeContext';
import { VerificationBadge } from './VerificationBadge';
import { Avatar } from './Avatar';

interface SettingsProps {
  user: any | null;
  userProfile: UserProfile;
  onLogout: () => void;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  onDeleteAccount: () => Promise<{ success: boolean; error?: string }>;
  onNavigate: (route: string) => void;
}

/** Simple chevron used on every settings row (WhatsApp style) */
const ChevronRight = () => (
  <svg className="w-5 h-5 text-neutral-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

/** WhatsApp-style settings row: icon + title + subtitle + chevron */
const SettingsRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}> = ({ icon, title, subtitle, onClick, rightElement, danger }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-4 px-4 py-3.5 text-left active:bg-neutral-100 dark:active:bg-white/5 transition-colors ${
      danger ? 'text-red-600' : 'text-neutral-900 dark:text-white'
    }`}
  >
    <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0 text-neutral-600 dark:text-neutral-300">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <span className={`font-medium text-[16px] block ${danger ? 'text-red-600' : ''}`}>{title}</span>
      {subtitle && <span className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-tight block mt-0.5">{subtitle}</span>}
    </div>
    {rightElement ?? <ChevronRight />}
  </button>
);

const Switch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }> = ({
  checked,
  onChange,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex items-center h-7 rounded-full w-12 transition-colors focus:outline-none disabled:opacity-50 ${
      checked ? 'bg-[#25D366]' : 'bg-neutral-300 dark:bg-neutral-600'
    }`}
  >
    <span
      className={`inline-block w-5 h-5 transform bg-white rounded-full transition-transform shadow-sm ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

export const SettingsScreen: React.FC<SettingsProps> = ({
  user,
  userProfile,
  onLogout,
  onProfileUpdate,
  onDeleteAccount,
  onNavigate,
}) => {
  const { mode, setMode } = useTheme();
  const [isNotificationSwitchOn, setIsNotificationSwitchOn] = useState(userProfile.notifications_enabled);
  const [isNotificationSaving, setIsNotificationSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetEmailSending, setIsResetEmailSending] = useState(false);
  const { addToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    setIsNotificationSwitchOn(userProfile.notifications_enabled);
  }, [userProfile.notifications_enabled]);

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

  const handlePasswordReset = async () => {
    if (!user?.email) {
      addToast('No email address found for this account.', 'error');
      return;
    }
    setIsResetEmailSending(true);
    try {
      const res = await supabaseAuthService.sendPasswordReset(user.email);
      if (!res.success) throw new Error(res.error || 'Failed to send password reset email');
      addToast('Password reset email sent! Check your inbox.', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to send password reset email.', 'error');
    } finally {
      setIsResetEmailSending(false);
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

  const matchSearch = (title: string, subtitle?: string) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return title.toLowerCase().includes(q) || (subtitle && subtitle.toLowerCase().includes(q));
  };

  return (
    <div className="bg-[#F0F2F5] dark:bg-black min-h-full animate-in fade-in duration-300">
      {/* WhatsApp-style top header bar */}
      <div className="sticky top-0 z-20 bg-white dark:bg-[#111111] px-4 py-3 flex items-center gap-4 border-b border-neutral-200/80 dark:border-white/10">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="p-1 -ml-1 text-neutral-700 dark:text-neutral-200"
          aria-label="Back"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {isSearchOpen ? (
          <input
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            className="flex-1 bg-transparent text-[16px] text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none"
          />
        ) : (
          <h1 className="text-[20px] font-medium text-neutral-900 dark:text-white flex-1">Settings</h1>
        )}
        <button
          type="button"
          onClick={() => {
            setIsSearchOpen(!isSearchOpen);
            if (isSearchOpen) setSearchQuery('');
          }}
          className="p-1 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition"
          aria-label="Search"
        >
          {isSearchOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </button>
      </div>

      {/* Profile header – exact WhatsApp layout */}
      <div className="bg-white dark:bg-[#111111] mt-0">
        <button
          type="button"
          onClick={() => onNavigate('user_profile')}
          className="w-full flex items-center gap-4 px-4 py-4 active:bg-neutral-50 dark:active:bg-white/5 transition-colors"
        >
          <Avatar
            display_name={userProfile.display_name}
            photo_url={userProfile.photo_url}
            className="w-16 h-16 ring-2 ring-neutral-100 dark:ring-white/10"
          />
          <div className="min-w-0 flex-1 text-left">
            <p className="font-medium text-[18px] text-neutral-900 dark:text-white flex items-center gap-1.5 truncate">
              {userProfile.display_name || 'User'}
              <VerificationBadge status={userProfile.subscription_status} />
            </p>
            <p className="text-[14px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
              @{userProfile.display_name?.toLowerCase().replace(/\s+/g, '') || 'avelut'}
            </p>
          </div>
          <div className="flex items-center gap-3 text-neutral-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <ChevronRight />
          </div>
        </button>
      </div>

      {/* Credits / billing quick card */}
      <div
        onClick={() => onNavigate('billing')}
        role="button"
        tabIndex={0}
        className="bg-white dark:bg-[#111111] mt-2.5 cursor-pointer active:bg-neutral-50 dark:active:bg-white/5 transition-colors"
      >
        <div className="px-4 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-neutral-500 uppercase tracking-wide">Credits balance</p>
            <p className="text-2xl font-bold text-neutral-900 dark:text-white mt-0.5">
              {userProfile.ai_credits_balance ?? 0}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-200 capitalize">
              {userProfile.subscription_status || 'Free'}
            </span>
            <ChevronRight />
          </div>
        </div>
      </div>

      {/* Profile & Academic Details */}
      {(matchSearch('Profile Details', 'Display name, avatar, bio & contact') ||
        matchSearch('Academic Information', 'School, department, academic level') ||
        matchSearch('Avelut Pro & Verification', 'Get verified badge, unlimited AI tokens & perks')) && (
        <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
          {matchSearch('Profile Details', 'Display name, avatar, bio & contact') && (
            <SettingsRow
              icon={<i className="bi bi-person text-lg" />}
              title="Profile Details"
              subtitle="Display name, avatar, bio & contact"
              onClick={() => onNavigate('user_profile')}
            />
          )}
          {matchSearch('Academic Information', 'School, department, academic level') && (
            <SettingsRow
              icon={<i className="bi bi-mortarboard text-lg" />}
              title="Academic Information"
              subtitle={
                userProfile.department_id || userProfile.level
                  ? `${userProfile.department_id ? userProfile.department_id.replace(/_/g, ' ') : ''}${userProfile.department_id && userProfile.level ? ' • ' : ''}${userProfile.level ? userProfile.level + ' Level' : ''}`
                  : 'School, department, academic level'
              }
              onClick={() => onNavigate('user_profile')}
            />
          )}
          {matchSearch('Avelut Pro & Verification', 'Get verified badge, unlimited AI tokens & perks') && (
            <SettingsRow
              icon={<i className="bi bi-patch-check text-lg text-[#009EE2]" />}
              title="Avelut Pro & Verification"
              subtitle="Get verified badge, unlimited AI tokens & perks"
              onClick={() => onNavigate('billing')}
            />
          )}
        </div>
      )}

      {/* Study Network & History */}
      {(matchSearch('Study Partners', 'Find classmates & manage connection requests') ||
        matchSearch('Study History & AI Logs', 'Past conversations, tutorials, and notes') ||
        matchSearch('Study Guide & Courses', 'Browse curriculum, syllabus & unit progress') ||
        matchSearch('My Notebooks', 'Saved study notes and summaries')) && (
        <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
          {matchSearch('Study Partners', 'Find classmates & manage connection requests') && (
            <SettingsRow
              icon={<i className="bi bi-people text-lg" />}
              title="Study Partners"
              subtitle="Find classmates & manage connection requests"
              onClick={() => onNavigate('study_partners')}
            />
          )}
          {matchSearch('Study History & AI Logs', 'Past conversations, tutorials, and notes') && (
            <SettingsRow
              icon={<i className="bi bi-clock-history text-lg" />}
              title="Study History & AI Logs"
              subtitle="Past conversations, tutorials, and notes"
              onClick={() => onNavigate('history')}
            />
          )}
          {matchSearch('Study Guide & Courses', 'Browse curriculum, syllabus & unit progress') && (
            <SettingsRow
              icon={<i className="bi bi-book text-lg" />}
              title="Study Guide & Courses"
              subtitle="Browse curriculum, syllabus & unit progress"
              onClick={() => onNavigate('study_guide')}
            />
          )}
          {matchSearch('My Notebooks', 'Saved study notes and summaries') && (
            <SettingsRow
              icon={<i className="bi bi-journal-text text-lg" />}
              title="My Notebooks"
              subtitle="Saved study notes and summaries"
              onClick={() => onNavigate('notebooks')}
            />
          )}
        </div>
      )}

      {/* App Preferences */}
      {(matchSearch('Appearance', 'Chat theme, app icon, app theme') ||
        matchSearch('Push Notifications', 'Alerts for messages, requests & updates') ||
        matchSearch('Billing & Plans', 'Top-up AI credits, view plans & invoices')) && (
        <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
          {matchSearch('Appearance', 'Chat theme, app icon, app theme') && (
            <SettingsRow
              icon={<i className="bi bi-moon-stars text-lg" />}
              title="Appearance"
              subtitle={mode === 'dark' ? 'Dark theme active' : 'Light theme active'}
              rightElement={
                <Switch checked={mode === 'dark'} onChange={(c) => setMode(c ? 'dark' : 'light')} />
              }
            />
          )}
          {matchSearch('Push Notifications', 'Alerts for messages, requests & updates') && (
            <SettingsRow
              icon={<i className="bi bi-bell text-lg" />}
              title="Push Notifications"
              subtitle="Alerts for messages, requests & updates"
              rightElement={
                <Switch
                  checked={isNotificationSwitchOn}
                  onChange={handleNotificationToggle}
                  disabled={isNotificationSaving}
                />
              }
            />
          )}
          {matchSearch('Billing & Plans', 'Top-up AI credits, view plans & invoices') && (
            <SettingsRow
              icon={<i className="bi bi-credit-card text-lg" />}
              title="Billing & Plans"
              subtitle="Top-up AI credits, view plans & invoices"
              onClick={() => onNavigate('billing')}
            />
          )}
        </div>
      )}

      {/* Security & Support */}
      {(matchSearch('Password & Security', 'Send password reset link to your email') ||
        matchSearch('Help & Support', 'User guides, FAQs & interactive tour') ||
        matchSearch('Send Feedback', 'Report issues or suggest features')) && (
        <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
          {matchSearch('Password & Security', 'Send password reset link to your email') && (
            <SettingsRow
              icon={<i className="bi bi-shield-lock text-lg" />}
              title="Password & Security"
              subtitle={isResetEmailSending ? 'Sending reset link…' : 'Send password reset link to your email'}
              onClick={handlePasswordReset}
            />
          )}
          {matchSearch('Help & Support', 'User guides, FAQs & interactive tour') && (
            <SettingsRow
              icon={<i className="bi bi-question-circle text-lg" />}
              title="Help & Support"
              subtitle="User guides, FAQs & interactive tour"
              onClick={() => onNavigate('help')}
            />
          )}
          {matchSearch('Send Feedback', 'Tell us what to improve') && (
            <SettingsRow
              icon={<i className="bi bi-chat-square-quote text-lg" />}
              title="Send Feedback"
              subtitle="Report issues or suggest features"
              onClick={() => onNavigate('feedback')}
            />
          )}
        </div>
      )}

      {/* Terms & Policies */}
      {(matchSearch('Terms & Conditions') || matchSearch('Privacy Policy')) && (
        <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
          {matchSearch('Terms & Conditions') && (
            <a
              href="/t&c"
              className="w-full flex items-center gap-4 px-4 py-3.5 text-left active:bg-neutral-100 dark:active:bg-white/5 transition-colors text-neutral-900 dark:text-white"
            >
              <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0 text-neutral-600 dark:text-neutral-300">
                <i className="bi bi-file-text text-lg" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-[16px] block">Terms & Conditions</span>
              </div>
              <ChevronRight />
            </a>
          )}
          {matchSearch('Privacy Policy') && (
            <a
              href="https://www.avelut.xyz/policy"
              className="w-full flex items-center gap-4 px-4 py-3.5 text-left active:bg-neutral-100 dark:active:bg-white/5 transition-colors text-neutral-900 dark:text-white"
            >
              <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0 text-neutral-600 dark:text-neutral-300">
                <i className="bi bi-shield-check text-lg" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-[16px] block">Privacy Policy</span>
              </div>
              <ChevronRight />
            </a>
          )}
        </div>
      )}

      {/* Account Actions */}
      <div className="bg-white dark:bg-[#111111] mt-2.5 divide-y divide-neutral-100 dark:divide-white/5">
        <SettingsRow
          icon={<i className="bi bi-box-arrow-right text-lg" />}
          title="Log out"
          onClick={onLogout}
        />
        <SettingsRow
          icon={<i className="bi bi-trash text-lg text-red-500" />}
          title="Delete account"
          danger
          onClick={() => setIsDeleteModalOpen(true)}
        />
      </div>

      <div className="h-10" />

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        title="Delete Account"
        message="Are you sure? This will permanently delete your account, all chat history, credits, and subscriptions."
        onConfirm={confirmDeletion}
        onCancel={() => setIsDeleteModalOpen(false)}
        confirmText="Yes, delete my account"
        isConfirming={isDeleting}
      />
    </div>
  );
};
