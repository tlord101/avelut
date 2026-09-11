import { db, off, onValue, ref as dbRef } from '@/lib/backend';
import React, { useEffect } from 'react';
import type { UserProfile, ChatConversation } from '../types';
import { Chat } from './Chat';
import { getLocalConversations } from '../services/chatStorageService';

interface AvelutAIProps {
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
  unreadMessagesCount?: number;
  onConversationsUpdate?: (conversations: ChatConversation[]) => void;
  onOpenMenu?: () => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string | null) => void;
}

/** Avelut AI chat shell — uses unified Grok-style Chat component */
export default function AvelutAI({
  userProfile,
  onNavigate,
  setCustomHeaderConfig,
  unreadMessagesCount = 0,
  onConversationsUpdate,
  onOpenMenu,
  activeConversationId,
  onSelectConversation,
}: AvelutAIProps) {
  useEffect(() => {
    if (!userProfile?.uid || !onConversationsUpdate) return;
    let isMounted = true;

    getLocalConversations(userProfile.uid)
      .then((local) => {
        if (isMounted && local.length > 0) {
          onConversationsUpdate(
            local.map((c) => ({
              id: c.id,
              user_id: c.user_id || userProfile.uid,
              title: c.title || 'New Chat',
              created_at: c.created_at || 0,
              last_updated_at: c.last_updated_at || c.created_at || 0,
            }))
          );
        }
      })
      .catch(() => {});

    const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
    const unsubscribe = onValue(conversationsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data: any[] = [];
        snapshot.forEach((child) => {
          const val = child.val() || {};
          data.push({ id: child.key, user_id: val.user_id || userProfile.uid, ...val });
        });
        const sorted = data.sort((a, b) => b.last_updated_at - a.last_updated_at);
        if (isMounted) onConversationsUpdate(sorted as ChatConversation[]);
      } else {
        getLocalConversations(userProfile.uid)
          .then((local) => {
            if (isMounted && local.length > 0) {
              onConversationsUpdate(
                local.map((c) => ({
                  id: c.id,
                  user_id: c.user_id || userProfile.uid,
                  title: c.title || 'New Chat',
                  created_at: c.created_at || 0,
                  last_updated_at: c.last_updated_at || c.created_at || 0,
                }))
              );
            } else if (isMounted) {
              onConversationsUpdate([]);
            }
          })
          .catch(() => {});
      }
    });

    return () => {
      isMounted = false;
      off(conversationsRef);
    };
  }, [userProfile?.uid, onConversationsUpdate]);

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-white dark:bg-black">
      <Chat
        userProfile={userProfile}
        onNavigate={onNavigate}
        onOpenMenu={onOpenMenu}
        setCustomHeaderConfig={setCustomHeaderConfig}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
      />
    </div>
  );
}
