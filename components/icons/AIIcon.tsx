import React from 'react';

export const AIIcon: React.FC<{ active?: boolean; className?: string }> = ({ active, className = 'w-6 h-6' }) => {
  const color = active ? '#0052FF' : '#002D62';
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke={color} 
      strokeWidth={2.2} 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      {/* Head */}
      <rect x="5" y="8" width="14" height="11" rx="3" fill={active ? '#0052FF' : 'none'} stroke={color} strokeWidth={2.2} />
      {/* Ears */}
      <path d="M5 12.5a1.5 1.5 0 0 0 0 2.5" />
      <path d="M19 12.5a1.5 1.5 0 0 1 0 2.5" />
      {/* Antenna */}
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1.2" fill={color} stroke="none" />
      {/* Eyes */}
      <circle cx="9.5" cy="13" r="1.2" fill={active ? '#FFFFFF' : color} stroke="none" />
      <circle cx="14.5" cy="13" r="1.2" fill={active ? '#FFFFFF' : color} stroke="none" />
      {/* Smile */}
      <path d="M10.5 16a2 2 0 0 0 3 0" stroke={active ? '#FFFFFF' : color} strokeWidth={1.8} />
      {/* Gear on Top Right */}
      <g transform="translate(16.5, 4.5)">
        <circle cx="2.5" cy="2.5" r="2" fill="none" stroke={color} strokeWidth={1.8} />
        {/* Teeth */}
        <path d="M2.5 0v1M2.5 4v1M0 2.5h1M4 2.5h1" stroke={color} strokeWidth={1} />
      </g>
    </svg>
  );
};
