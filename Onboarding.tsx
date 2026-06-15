import React from 'react';
import type { UserProfile, AppSettings } from './types';
import { SubscriptionCards } from './components/SubscriptionCards';

interface OnboardingProps {
    userProfile: UserProfile;
    appSettings: AppSettings;
    onComplete: (plan: 'free' | 'basic' | 'pro' | 'personal_token', extraData?: { apiKey: string }) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ userProfile, appSettings, onComplete }) => {
    return (
        <div className="w-full max-w-5xl mx-auto py-8">
            <div className="text-center mb-10">
                <h2 className="text-3xl font-black text-slate-900 mb-4">Choose Your Path</h2>
                <p className="text-slate-500 font-medium">Select the plan that best fits your academic goals.</p>
            </div>

            <SubscriptionCards
                userProfile={userProfile}
                appSettings={appSettings}
                onSelectPlan={onComplete}
                showCurrentPlan={false}
            />
        </div>
    );
};
