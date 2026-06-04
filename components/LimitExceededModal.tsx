import React, { useState } from 'react';
import type { UserProfile, AppSettings } from '../types';
import { triggerPaystackPurchase } from '../utils/usage';
import { db } from '../firebase';
import { ref as dbRef, get, update } from 'firebase/database';

interface LimitExceededModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  appSettings: AppSettings;
  featureType: 'visual_messages' | 'courses' | 'ai_requests_per_course' | 'exams';
  courseId?: string; // required if featureType is ai_requests_per_course
  limitValue: number;
  usedValue: number;
  price: number;
  batchCount?: number;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onSuccessPurchase: () => void;
}

export const LimitExceededModal: React.FC<LimitExceededModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  appSettings,
  featureType,
  courseId,
  limitValue,
  usedValue,
  price,
  batchCount = 1,
  addToast,
  onSuccessPurchase,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const getFeatureLabel = () => {
    switch (featureType) {
      case 'visual_messages':
        return 'AI Visual Solver / Chat Assistant';
      case 'courses':
        return 'Roadmap Course Outline Unlocks';
      case 'ai_requests_per_course':
        return 'Syllabus Lesson AI Requests';
      case 'exams':
        return 'Mock Practice Exam Generations';
      default:
        return 'VanTutor Premium Features';
    }
  };

  const getPurchaseOptionDescription = () => {
    switch (featureType) {
      case 'visual_messages':
        return `Unlock ${batchCount} additional AI solver messages.`;
      case 'courses':
        return `Unlock 1 additional roadmap course of your department curriculum.`;
      case 'ai_requests_per_course':
        return `Unlock ${batchCount} more AI requests for this course in the current 2h window.`;
      case 'exams':
        return `Unlock ${batchCount} more mock practice exams.`;
      default:
        return 'Unlock additional usage batch.';
    }
  };

  const handlePurchase = async () => {
    setIsProcessing(true);
    const publicKey = appSettings.paystack_public_key?.trim();
    const email = userProfile.email || `${userProfile.uid}@vantutor.com`;

    await triggerPaystackPurchase({
      publicKey,
      email,
      amount: price,
      userId: userProfile.uid,
      purchaseType: featureType === 'visual_messages' 
        ? 'additional_messages' 
        : featureType === 'courses' 
          ? 'additional_course' 
          : featureType === 'exams'
            ? 'additional_exams'
            : 'additional_course_request',
      metadata: { 
        feature: featureType, 
        course_id: courseId || null,
        batch_count: batchCount 
      },
      addToast,
      onSuccess: async (reference) => {
        try {
          const statsRef = dbRef(db, `users/${userProfile.uid}/usage_stats`);
          const currentSnap = await get(statsRef);
          const stats = currentSnap.val() || {};

          if (featureType === 'visual_messages') {
            const purchased = (stats.additional_visual_messages_purchased || 0) + batchCount;
            await update(statsRef, { additional_visual_messages_purchased: purchased });
          } else if (featureType === 'courses') {
            const purchased = (stats.additional_courses_purchased || 0) + 1;
            await update(statsRef, { additional_courses_purchased: purchased });
          } else if (featureType === 'exams') {
            const purchased = (stats.additional_exams_purchased || 0) + batchCount;
            await update(statsRef, { additional_exams_purchased: purchased });
          } else if (featureType === 'ai_requests_per_course' && courseId) {
            const coursesRequests = stats.courses_requests || {};
            const courseData = coursesRequests[courseId] || { requests_used: 0, window_start_time: Date.now(), additional_requests_purchased: 0 };
            
            courseData.additional_requests_purchased = (courseData.additional_requests_purchased || 0) + batchCount;
            coursesRequests[courseId] = courseData;
            await update(statsRef, { courses_requests: coursesRequests });
          }

          addToast('Additional usage unlocked successfully!', 'success');
          onSuccessPurchase();
          onClose();
        } catch (e: any) {
          console.error(e);
          addToast('Payment received but limits failed to update. Contact support.', 'error');
        } finally {
          setIsProcessing(false);
        }
      },
      onCancel: () => {
        setIsProcessing(false);
      },
      onError: (err) => {
        console.error(err);
        setIsProcessing(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Dark Blur Overlay */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      
      {/* Dialog Body */}
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-[28px] p-6 shadow-2xl animate-in scale-in duration-200">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center text-amber-600 mb-4 animate-pulse">
            ⚠️
          </div>
          <h3 className="text-lg font-black text-slate-900 leading-tight">
            Plan Limit Reached
          </h3>
          <p className="text-xs text-slate-500 mt-1 font-semibold">
            {getFeatureLabel()}
          </p>
        </div>

        <div className="my-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs font-semibold text-slate-700">
          <div className="flex justify-between">
            <span>Your Current Usage:</span>
            <span className="font-extrabold text-slate-900">{usedValue} requests</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2">
            <span>Your Plan Limit:</span>
            <span className="font-extrabold text-slate-900">{limitValue} requests</span>
          </div>
        </div>

        <div className="mb-6 bg-blue-50/50 border border-blue-200 rounded-2xl p-4 text-center">
          <span className="text-[9px] uppercase font-black tracking-widest text-blue-600 block mb-1">Pay-As-You-Go Unlock</span>
          <p className="text-xs text-slate-700 font-extrabold mb-3">
            {getPurchaseOptionDescription()}
          </p>
          <span className="text-2xl font-black text-slate-900">
            ₦{price.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="py-3 text-slate-500 hover:text-slate-800 text-xs font-black uppercase tracking-wider rounded-xl transition-all border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePurchase}
            disabled={isProcessing}
            className="py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Pay with Paystack'}
          </button>
        </div>
      </div>
    </div>
  );
};
