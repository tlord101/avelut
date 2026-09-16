import React, { useState } from 'react';
import type { UserProfile } from '../../types';

export interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  chats: any[];
  onForward: (targetChatId: string) => void;
  currentUserId: string;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  chats,
  onForward,
  currentUserId,
}) => {
  const [searchTerm, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filtered = chats.filter((c) => {
    const title = c.partner_profile?.display_name || c.title || 'Chat';
    return title.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-[#2A2A2A] text-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div className="flex justify-between items-center pb-2 border-b border-[#2A2A2A]">
          <h3 className="font-extrabold text-base">Forward Message</h3>
          <button onClick={onClose} className="p-1 text-[#A3A3A3] hover:text-white transition">
            <i className="bi bi-x-lg text-lg"></i>
          </button>
        </div>

        <input
          type="text"
          placeholder="Search chat or friend..."
          value={searchTerm}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full p-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-xs text-white placeholder-[#A3A3A3] outline-none focus:border-blue-500"
        />

        <div className="max-h-60 overflow-y-auto space-y-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#A3A3A3] text-center py-4">No chats found.</p>
          ) : (
            filtered.map((chat) => {
              const name = chat.partner_profile?.display_name || chat.title || 'Chat Mates';
              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    onForward(chat.id);
                    onClose();
                  }}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-[#1C1C1C] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={
                        chat.partner_profile?.photo_url ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`
                      }
                      alt=""
                      className="w-9 h-9 rounded-full object-cover"
                    />
                    <span className="text-xs font-bold text-white">{name}</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full">
                    Send
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
