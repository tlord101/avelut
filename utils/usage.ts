import { db } from '../firebase';
import { ref as dbRef, push, set, update, get } from 'firebase/database';
import type { UserProfile, AppSettings } from '../types';
import { DEFAULT_USAGE_SETTINGS } from './appSettings';

// Load Paystack script dynamically
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

interface PaystackPurchaseOptions {
  publicKey: string;
  email: string;
  amount: number;
  userId: string;
  purchaseType: 'subscription' | 'additional_messages' | 'additional_course' | 'additional_course_request' | 'additional_exams';
  metadata?: any;
  onSuccess: (reference: string) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: any) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const triggerPaystackPurchase = async (options: PaystackPurchaseOptions) => {
  const { publicKey, email, amount, userId, purchaseType, metadata, onSuccess, onCancel, onError, addToast } = options;

  let paymentLogRef: any = null;
  try {
    paymentLogRef = push(dbRef(db, 'usage_logs/payments'));
    await set(paymentLogRef, {
      id: paymentLogRef.key,
      user_id: userId,
      email: email,
      amount: amount,
      purchase_type: purchaseType,
      metadata: metadata || {},
      status: 'initiated',
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Failed to create payment log:', err);
  }

  if (!publicKey) {
    addToast('Demo Mode: Simulating checkout...', 'info');
    setTimeout(async () => {
      const referenceId = 'demo_' + Math.random().toString(36).substring(2, 11);
      if (paymentLogRef) {
        try {
          await update(paymentLogRef, { status: 'success', reference: referenceId });
        } catch (e) {}
      }
      try {
        await onSuccess(referenceId);
      } catch (e) {
        if (onError) onError(e);
      }
    }, 2000);
    return;
  }

  const isLoaded = await loadPaystackScript();
  if (!isLoaded) {
    addToast('Could not load payment gateway.', 'error');
    if (paymentLogRef) {
      try {
        await update(paymentLogRef, { status: 'failed', error: 'Script load failed' });
      } catch (e) {}
    }
    if (onError) onError(new Error('Paystack script load failed'));
    return;
  }

  try {
    const handler = (window as any).PaystackPop.setup({
      key: publicKey,
      email: email,
      amount: amount * 100, // in kobo
      currency: 'NGN',
      callback: (response: any) => {
        const runAsyncCallback = async () => {
          const reference = response?.reference || 'ref_missing';
          if (paymentLogRef) {
            try {
              await update(paymentLogRef, { status: 'success', reference });
            } catch (e) {}
          }
          try {
            await onSuccess(reference);
          } catch (e) {
            if (onError) onError(e);
          }
        };
        void runAsyncCallback();
      },
      onClose: () => {
        const runAsyncClose = async () => {
          if (paymentLogRef) {
            try {
              await update(paymentLogRef, { status: 'cancelled' });
            } catch (e) {}
          }
          addToast('Payment cancelled.', 'info');
          if (onCancel) onCancel();
        };
        void runAsyncClose();
      },
    });
    handler.openIframe();
  } catch (e: any) {
    console.error(e);
    if (paymentLogRef) {
      try {
        await update(paymentLogRef, { status: 'failed', error: e.message });
      } catch (err) {}
    }
    addToast('Error during payment processing.', 'error');
    if (onError) onError(e);
  }
};

// Check if user is exempt from limits
const isExempt = (userProfile: UserProfile): boolean => {
  return !!(userProfile.is_admin || userProfile.use_personal_token || userProfile.subscription_status === 'personal_token');
};

// 1. Visual solver/chat limits
export const checkVisualMessagesLimit = (
  userProfile: UserProfile,
  usageStats: any,
  appSettings: AppSettings
) => {
  if (isExempt(userProfile)) {
    return { allowed: true, used: 0, limit: Infinity, price: 0, count: Infinity };
  }

  const planKey = (userProfile.subscription_status || 'free') as 'free' | 'basic' | 'pro';
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;
  
  const planLimit = usageSettings.plans[planKey]?.limits?.visual_messages ?? DEFAULT_USAGE_SETTINGS.plans.free.limits.visual_messages;
  const additionalPurchased = usageStats?.additional_visual_messages_purchased || 0;
  const used = usageStats?.visual_messages_used || 0;
  
  const allowed = used < (planLimit + additionalPurchased);
  const price = usageSettings.additional_prices?.visual_messages_price ?? DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_price;
  const count = usageSettings.additional_prices?.visual_messages_count ?? DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_count;

  return { allowed, used, limit: planLimit + additionalPurchased, price, count };
};

// 2. Exams limit
export const checkExamsLimit = (
  userProfile: UserProfile,
  usageStats: any,
  appSettings: AppSettings
) => {
  if (isExempt(userProfile)) {
    return { allowed: true, used: 0, limit: Infinity, price: 0, count: Infinity };
  }

  const planKey = (userProfile.subscription_status || 'free') as 'free' | 'basic' | 'pro';
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;

  const planLimit = usageSettings.plans[planKey]?.limits?.exams ?? DEFAULT_USAGE_SETTINGS.plans.free.limits.exams;
  const additionalPurchased = usageStats?.additional_exams_purchased || 0;
  const used = usageStats?.exams_generated || 0;

  const allowed = used < (planLimit + additionalPurchased);
  const price = 200; // default NGN
  const count = 5; // default 5 additional exams

  return { allowed, used, limit: planLimit + additionalPurchased, price, count };
};

// 3. Study guide courses limit
export const checkStudyGuideCoursesLimit = (
  userProfile: UserProfile,
  usageStats: any,
  appSettings: AppSettings
) => {
  if (isExempt(userProfile)) {
    return { allowed: true, used: 0, limit: Infinity, price: 0 };
  }

  const planKey = (userProfile.subscription_status || 'free') as 'free' | 'basic' | 'pro';
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;

  const planLimit = usageSettings.plans[planKey]?.limits?.courses ?? DEFAULT_USAGE_SETTINGS.plans.free.limits.courses;
  const additionalPurchased = usageStats?.additional_courses_purchased || 0;
  const unlockedCount = Object.keys(usageStats?.unlocked_courses || {}).length;

  const allowed = unlockedCount < (planLimit + additionalPurchased);
  const price = usageSettings.additional_prices?.studyguide_course_price ?? DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_course_price;

  return { allowed, used: unlockedCount, limit: planLimit + additionalPurchased, price };
};

// 4. Study guide requests limit per course (resets every 2 hours)
export const checkStudyGuideCourseRequestsLimit = (
  courseId: string,
  userProfile: UserProfile,
  usageStats: any,
  appSettings: AppSettings
) => {
  if (isExempt(userProfile)) {
    return { allowed: true, used: 0, limit: Infinity, price: 0, count: Infinity, secondsLeft: 0 };
  }

  const planKey = (userProfile.subscription_status || 'free') as 'free' | 'basic' | 'pro';
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;

  const planLimit = usageSettings.plans[planKey]?.limits?.ai_requests_per_course ?? DEFAULT_USAGE_SETTINGS.plans.free.limits.ai_requests_per_course;
  
  const courseData = usageStats?.courses_requests?.[courseId] || { requests_used: 0, window_start_time: Date.now(), additional_requests_purchased: 0 };
  
  const now = Date.now();
  const windowDuration = 2 * 60 * 60 * 1000; // 2 hours
  const timeElapsed = now - courseData.window_start_time;

  let requestsUsed = courseData.requests_used;
  let windowStart = courseData.window_start_time;

  if (timeElapsed > windowDuration) {
    requestsUsed = 0;
    windowStart = now;
  }

  const additionalPurchased = courseData.additional_requests_purchased || 0;
  const allowed = requestsUsed < (planLimit + additionalPurchased);
  const price = usageSettings.additional_prices?.studyguide_request_price ?? DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_request_price;
  const count = 5; // 5 additional requests per purchase

  const secondsLeft = Math.max(0, Math.ceil((windowDuration - timeElapsed) / 1000));

  return { allowed, used: requestsUsed, limit: planLimit + additionalPurchased, price, count, secondsLeft, windowStart };
};

// Update message usage counter
export const incrementVisualMessagesUsed = async (userId: string) => {
  try {
    const statsRef = dbRef(db, `users/${userId}/usage_stats`);
    const snapshot = await push(dbRef(db, `users/${userId}/temp`)); // just a dummy to fetch then update, or runTransaction. Let's do a simple get/update.
    // Or we use standard Realtime Database update / incremental structure.
    // Actually, get and update is fast enough and simple:
    const dataRef = dbRef(db, `users/${userId}/usage_stats/visual_messages_used`);
    // Wait, let's run a transaction or fetch first
    const usageStatsRef = dbRef(db, `users/${userId}/usage_stats`);
    const currentSnap = await get(usageStatsRef);
    const currentVal = currentSnap.val() || {};
    const newUsed = (currentVal.visual_messages_used || 0) + 1;
    await update(usageStatsRef, { visual_messages_used: newUsed });
  } catch (err) {
    console.error('Failed to increment visual messages:', err);
  }
};

// Update exams generated counter
export const incrementExamsGenerated = async (userId: string) => {
  try {
    const usageStatsRef = dbRef(db, `users/${userId}/usage_stats`);
    const currentSnap = await get(usageStatsRef);
    const currentVal = currentSnap.val() || {};
    const newUsed = (currentVal.exams_generated || 0) + 1;
    await update(usageStatsRef, { exams_generated: newUsed });
  } catch (err) {
    console.error('Failed to increment exams generated:', err);
  }
};

// Update course AI requests counter
export const incrementCourseRequestsUsed = async (userId: string, courseId: string, windowStart: number) => {
  try {
    const usageStatsRef = dbRef(db, `users/${userId}/usage_stats`);
    const currentSnap = await get(usageStatsRef);
    const currentVal = currentSnap.val() || {};
    const coursesRequests = currentVal.courses_requests || {};
    const courseData = coursesRequests[courseId] || { requests_used: 0, window_start_time: windowStart, additional_requests_purchased: 0 };
    
    courseData.requests_used = (courseData.requests_used || 0) + 1;
    courseData.window_start_time = windowStart; // preserve window start

    coursesRequests[courseId] = courseData;
    await update(usageStatsRef, { courses_requests: coursesRequests });
  } catch (err) {
    console.error('Failed to increment course requests:', err);
  }
};
