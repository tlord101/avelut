import { runQuery, runStatement } from '../lib/sqlite/sqliteService';

export interface LocalConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  last_updated_at: number;
  sync_status?: 'synced' | 'pending' | 'syncing' | 'error';
  is_deleted?: number;
}

export interface LocalMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  attachments_json?: string | null;
  image_url?: string | null;
  timestamp: number;
  sync_status?: 'synced' | 'pending' | 'syncing' | 'error';
  is_deleted?: number;
}

export interface SyncQueueItem {
  id: string;
  entity_type: 'conversation' | 'message' | 'app_state' | 'history' | 'flashcard' | 'exam' | 'notebook';
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  payload_json: string;
  retry_count: number;
  created_at: number;
  last_error?: string | null;
}

/**
 * Generate a unique client-side UUID/ID.
 */
export function generateLocalId(prefix: string = 'loc'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Fetch all active conversations for the specified user from local SQLite.
 */
export async function getLocalConversations(userId: string): Promise<LocalConversation[]> {
  if (!userId) return [];
  const sql = `
    SELECT id, user_id, title, created_at, last_updated_at, sync_status, is_deleted
    FROM conversations
    WHERE user_id = ? AND is_deleted = 0
    ORDER BY last_updated_at DESC
  `;
  return runQuery<LocalConversation>(sql, [userId]);
}

/**
 * Fetch all active messages for a given conversation from local SQLite in chronological order.
 */
export async function getLocalMessages(conversationId: string): Promise<LocalMessage[]> {
  if (!conversationId) return [];
  const sql = `
    SELECT id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted
    FROM messages
    WHERE conversation_id = ? AND is_deleted = 0
    ORDER BY timestamp ASC
  `;
  return runQuery<LocalMessage>(sql, [conversationId]);
}

/**
 * Save or update a conversation locally in SQLite with zero latency.
 */
export async function saveLocalConversation(
  conversation: { id: string; user_id: string; title: string; created_at?: number; last_updated_at?: number },
  enqueueSync: boolean = true
): Promise<void> {
  const now = Date.now();
  const createdAt = conversation.created_at || now;
  const lastUpdatedAt = conversation.last_updated_at || now;
  const syncStatus = enqueueSync ? 'pending' : 'synced';

  const sql = `
    INSERT OR REPLACE INTO conversations (id, user_id, title, created_at, last_updated_at, sync_status, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `;

  await runStatement(sql, [
    conversation.id,
    conversation.user_id,
    conversation.title,
    createdAt,
    lastUpdatedAt,
    syncStatus,
    0
  ]);

  if (enqueueSync) {
    await enqueueSyncAction('conversation', conversation.id, 'update', {
      id: conversation.id,
      user_id: conversation.user_id,
      title: conversation.title,
      created_at: createdAt,
      last_updated_at: lastUpdatedAt
    });
  }
}

/**
 * Save a new message locally into SQLite instantly and enqueue for background sync.
 */
export async function saveLocalMessage(
  message: {
    id: string;
    conversation_id: string;
    user_id: string;
    sender: 'user' | 'assistant' | 'system';
    text: string;
    attachments_json?: string | null;
    image_url?: string | null;
    timestamp?: number;
  },
  enqueueSync: boolean = true
): Promise<void> {
  const timestamp = message.timestamp || Date.now();
  const syncStatus = enqueueSync ? 'pending' : 'synced';

  const sql = `
    INSERT OR REPLACE INTO messages (id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `;

  await runStatement(sql, [
    message.id,
    message.conversation_id,
    message.user_id,
    message.sender,
    message.text,
    message.attachments_json || null,
    message.image_url || null,
    timestamp,
    syncStatus,
    0
  ]);

  // Update conversation's last_updated_at in SQLite
  await runStatement(
    `UPDATE conversations SET last_updated_at = ? WHERE id = ?`,
    [timestamp, message.conversation_id]
  );

  if (enqueueSync) {
    await enqueueSyncAction('message', message.id, 'create', {
      id: message.id,
      conversation_id: message.conversation_id,
      user_id: message.user_id,
      sender: message.sender,
      text: message.text,
      attachments_json: message.attachments_json || null,
      image_url: message.image_url || null,
      timestamp
    });
  }
}

/**
 * Rename a conversation locally in SQLite.
 */
export async function renameLocalConversation(conversationId: string, newTitle: string, userId: string): Promise<void> {
  const now = Date.now();
  await runStatement(
    `UPDATE conversations SET title = ?, last_updated_at = ?, sync_status = 'pending' WHERE id = ?`,
    [newTitle, now, conversationId]
  );

  await enqueueSyncAction('conversation', conversationId, 'update', {
    id: conversationId,
    user_id: userId,
    title: newTitle,
    last_updated_at: now
  });
}

/**
 * Delete a conversation and all its messages locally in SQLite (soft delete).
 */
export async function deleteLocalConversation(conversationId: string, userId?: string): Promise<void> {
  // Soft delete locally
  await runStatement(
    `UPDATE conversations SET is_deleted = 1, sync_status = 'pending' WHERE id = ?`,
    [conversationId]
  );
  await runStatement(
    `UPDATE messages SET is_deleted = 1, sync_status = 'pending' WHERE conversation_id = ?`,
    [conversationId]
  );

  await enqueueSyncAction('conversation', conversationId, 'delete', {
    id: conversationId,
    user_id: userId
  });
}

/**
 * Save arbitrary application state / user progress / preferences to SQLite.
 */
export async function saveLocalAppState<T>(
  key: string,
  userId: string,
  category: string,
  payload: T,
  enqueueSync: boolean = false
): Promise<void> {
  const now = Date.now();
  const payloadJson = JSON.stringify(payload);
  const syncStatus = enqueueSync ? 'pending' : 'synced';

  const sql = `
    INSERT OR REPLACE INTO app_state (key, user_id, category, payload_json, updated_at, sync_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  await runStatement(sql, [key, userId, category, payloadJson, now, syncStatus]);

  if (enqueueSync) {
    await enqueueSyncAction('app_state', key, 'update', { key, userId, category, payload });
  }
}

/**
 * Retrieve arbitrary application state from SQLite.
 */
export async function getLocalAppState<T>(key: string, fallback: T): Promise<T> {
  const sql = `SELECT payload_json FROM app_state WHERE key = ? LIMIT 1`;
  const rows = await runQuery<{ payload_json: string }>(sql, [key]);
  if (rows.length > 0 && rows[0].payload_json) {
    try {
      return JSON.parse(rows[0].payload_json) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Enqueue a mutation into the sync queue.
 */
export async function enqueueSyncAction(
  entityType: 'conversation' | 'message' | 'app_state' | 'history' | 'flashcard' | 'exam' | 'notebook',
  entityId: string,
  action: 'create' | 'update' | 'delete',
  payload: any
): Promise<void> {
  const queueId = generateLocalId('sq');
  const now = Date.now();
  const payloadJson = JSON.stringify(payload);

  const sql = `
    INSERT OR REPLACE INTO sync_queue (id, entity_type, entity_id, action, payload_json, retry_count, created_at, last_error)
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
  `;

  await runStatement(sql, [queueId, entityType, entityId, action, payloadJson, now]);
}

/**
 * Fetch all pending items in the sync queue.
 */
export async function getPendingSyncQueue(): Promise<SyncQueueItem[]> {
  const sql = `
    SELECT id, entity_type, entity_id, action, payload_json, retry_count, created_at, last_error
    FROM sync_queue
    ORDER BY created_at ASC
  `;
  return runQuery<SyncQueueItem>(sql);
}

/**
 * Remove an item from the sync queue once synced.
 */
export async function removeSyncQueueItem(id: string): Promise<void> {
  await runStatement(`DELETE FROM sync_queue WHERE id = ?`, [id]);
}

/**
 * Record an error and increment retry count for a failed sync item.
 */
export async function updateSyncQueueError(id: string, error: string): Promise<void> {
  await runStatement(
    `UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
    [error, id]
  );
}

/**
 * Mark a local conversation as synced with Firebase.
 */
export async function markConversationSynced(id: string): Promise<void> {
  await runStatement(`UPDATE conversations SET sync_status = 'synced' WHERE id = ?`, [id]);
}

/**
 * Mark a local message as synced with Firebase.
 */
export async function markMessageSynced(id: string): Promise<void> {
  await runStatement(`UPDATE messages SET sync_status = 'synced' WHERE id = ?`, [id]);
}

/**
 * Bulk upsert remote conversations fetched from Firebase down into local SQLite.
 */
export async function bulkUpsertRemoteConversations(conversations: LocalConversation[]): Promise<void> {
  for (const convo of conversations) {
    const sql = `
      INSERT INTO conversations (id, user_id, title, created_at, last_updated_at, sync_status, is_deleted)
      VALUES (?, ?, ?, ?, ?, 'synced', 0)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        last_updated_at = MAX(conversations.last_updated_at, excluded.last_updated_at),
        sync_status = 'synced'
    `;
    await runStatement(sql, [
      convo.id,
      convo.user_id,
      convo.title,
      convo.created_at,
      convo.last_updated_at
    ]);
  }
}

/**
 * Bulk upsert remote messages fetched from Firebase down into local SQLite.
 */
export async function bulkUpsertRemoteMessages(messages: LocalMessage[]): Promise<void> {
  for (const msg of messages) {
    const sql = `
      INSERT INTO messages (id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', 0)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        attachments_json = excluded.attachments_json,
        image_url = excluded.image_url,
        sync_status = 'synced'
    `;
    await runStatement(sql, [
      msg.id,
      msg.conversation_id,
      msg.user_id,
      msg.sender,
      msg.text,
      msg.attachments_json || null,
      msg.image_url || null,
      msg.timestamp
    ]);
  }
}
