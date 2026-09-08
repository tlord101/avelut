import { db, push, ref as dbRef, serverTimestamp, set } from '@/lib/backend';
import React, { useState } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';

interface FeedbackProps {
  userProfile: UserProfile;
}

export const Feedback: React.FC<FeedbackProps> = ({ userProfile }) => {
  const [feedbackType, setFeedbackType] = useState<'suggestion' | 'complaint' | 'bug'>('suggestion');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      return addToast('Please enter your feedback before submitting.', 'error');
    }

    setIsSubmitting(true);
    try {
      const feedbackRef = dbRef(db, 'feedback');
      const newFeedbackRef = push(feedbackRef);
      
      await set(newFeedbackRef, {
        id: newFeedbackRef.key,
        uid: userProfile.uid,
        type: feedbackType,
        content: content.trim(),
        timestamp: serverTimestamp(),
        status: 'pending'
      });

      addToast('Thank you for your feedback! It has been submitted successfully.', 'success');
      setContent('');
      setFeedbackType('suggestion');
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      addToast('Failed to submit feedback. Please try again later.', 'error');
    }
    setIsSubmitting(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Suggestion Box</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
          Help us improve! Share your ideas, report bugs, or let us know what's not working.
        </p>
      </div>

      <div className="bg-white dark:bg-[#111] rounded-3xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Feedback Type Selector */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">What kind of feedback is this?</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setFeedbackType('suggestion')}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${feedbackType === 'suggestion' ? 'border-[#009EE2] bg-[#009EE2]/5 text-[#009EE2]' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    <span className="font-bold">Suggestion</span>
                  </div>
                  <p className="text-xs opacity-80">I have an idea for a new feature.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setFeedbackType('bug')}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${feedbackType === 'bug' ? 'border-red-500 bg-red-500/5 text-red-600' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <span className="font-bold">Bug Report</span>
                  </div>
                  <p className="text-xs opacity-80">Something is broken or not working.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setFeedbackType('complaint')}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${feedbackType === 'complaint' ? 'border-blue-500 bg-blue-500/5 text-blue-600 dark:text-blue-400' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                    <span className="font-bold">Complaint</span>
                  </div>
                  <p className="text-xs opacity-80">I am unhappy with an experience.</p>
                </button>
              </div>
            </div>

            {/* Content Textarea */}
            <div className="space-y-2">
              <label htmlFor="feedbackContent" className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Details
              </label>
              <textarea
                id="feedbackContent"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Please describe your feedback in detail..."
                className="w-full h-40 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009EE2]/30 resize-none"
                maxLength={1000}
                required
              />
              <div className="flex justify-end">
                <span className={`text-xs font-bold ${content.length >= 1000 ? 'text-red-500' : 'text-slate-400'}`}>
                  {content.length} / 1000
                </span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-white/10 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !content.trim()}
                className="px-8 py-3 bg-[#009EE2] hover:bg-[#0085BF] text-white rounded-xl text-sm font-black tracking-wide shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    Send Feedback
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
