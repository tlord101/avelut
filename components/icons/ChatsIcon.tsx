import React from 'react';

export const ChatsIcon: React.FC<{ active?: boolean; className?: string }> = ({ active, className = 'w-6 h-6' }) => {
  const color = active ? '#0052FF' : '#002D62';
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill={active ? '#0052FF' : 'none'} 
      stroke={color} 
      strokeWidth={2.2} 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      {/* Chat bubble outline/fill */}
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.5-.8L4 20l.8-4.8A8.5 8.5 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5z" />
      {/* Lightning bolt inside */}
      <path 
        d="M13.5 8.5L9.5 13h3l-.8 3.5 4-4.5h-3l.8-3.5z" 
        fill={active ? '#FFFFFF' : color} 
        stroke="none" 
      />
    </svg>
  );
};
