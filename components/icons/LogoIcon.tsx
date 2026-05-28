import React, { useId } from 'react';

export const LogoIcon: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => {
    const gradientId = useId();
    const highlightId = useId();

    return (
        <svg viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
            <defs>
                <linearGradient id={`${gradientId}-brand`} x1="6" y1="6" x2="48" y2="38" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#B3E5FC" />
                    <stop offset="52%" stopColor="#0088CC" />
                    <stop offset="100%" stopColor="#002D62" />
                </linearGradient>
                <linearGradient id={`${highlightId}-brand`} x1="18" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#EAF8FF" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#B3E5FC" stopOpacity="0.45" />
                </linearGradient>
            </defs>
            <path
                className="loader-path-1"
                d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z"
                stroke={`url(#${gradientId}-brand)`}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                className="loader-path-2"
                d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21"
                stroke={`url(#${gradientId}-brand)`}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.95"
            />
            <path
                className="loader-path-3"
                d="M47.6667 17.5V26.25"
                stroke={`url(#${highlightId}-brand)`}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="25.5" cy="12" r="3.2" fill="#B3E5FC" fillOpacity="0.9" />
            <circle cx="19" cy="24" r="2.5" fill="#B3E5FC" fillOpacity="0.55" />
            <circle cx="33" cy="22" r="2.2" fill="#0088CC" fillOpacity="0.28" />
        </svg>
    );
};

export default LogoIcon;
