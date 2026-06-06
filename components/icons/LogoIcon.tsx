import React from 'react';

export const LogoIcon: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => {
    return (
        <span 
            className={`inline-flex items-center justify-center bg-white rounded-xl p-1 shadow-sm border border-gray-100/50 ${className}`}
            style={{ display: 'inline-flex', verticalAlign: 'middle' }}
        >
            <img 
                src="/logo_icon.png" 
                alt="AVELUT Logo" 
                className="w-full h-full object-contain"
                style={{ display: 'block' }}
            />
        </span>
    );
};

export default LogoIcon;

// Expose as a global fallback for environments/bundles that reference the symbol at runtime
if (typeof window !== 'undefined') {
    try {
        (window as any).LogoIcon = LogoIcon;
    } catch (e) {
        // ignore
    }
}

