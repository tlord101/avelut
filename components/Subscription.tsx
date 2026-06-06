import React from 'react';

/**
 * @deprecated Subscription functionality has been removed. The app is now free for all users.
 * This component is a placeholder and should not be used.
 */
export const Subscription: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col h-full w-full items-center justify-center p-8">
        <div className="text-center bg-white p-8 rounded-xl border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">Subscriptions Disabled</h2>
            <p className="text-gray-600 mt-2">
                Good news! All AVELUT features are now available for free to all users.
            </p>
        </div>
    </div>
  );
};
