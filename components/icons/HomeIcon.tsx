import React from 'react';

export const HomeIcon: React.FC<{ active?: boolean; className?: string }> = ({ active, className = 'w-6 h-6' }) => {
  const color = active ? '#0052FF' : '#002D62';
  if (active) {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 24 24" 
        fill={color} 
        className={className}
      >
        <path d="M12 3L3.5 10.5h2.5v9.5c0 .55.45 1 1 1h4v-6h2v6h4c.55 0 1-.45 1-1v-9.5h2.5L12 3z" />
      </svg>
    );
  }
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
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
};
