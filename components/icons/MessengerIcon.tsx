import React from 'react';

export const MessengerIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={className}>
        <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4.414a1 1 0 0 0-.707.293L1.5 15.5V4zm2-1a1 1 0 0 0-1 1v8.586l1.793-1.793A1 1 0 0 1 3.414 11H14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2z" />
    </svg>
);