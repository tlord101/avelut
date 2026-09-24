import { runQuery, runStatement } from '../lib/sqlite/sqliteService';
import { enqueueSyncAction, generateLocalId } from './chatStorageService';
import { SavedItem } from '../utils/history';

export interface LocalMaterialRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  data_json: string;
  created_at: number;
  sync_status: 'synced' | 'pending' | 'syncing' | 'error';
  is_deleted: number;
}

function mapRowToMaterial(row: LocalMaterialRow): SavedItem {
  let data: any = null;
  try {
    data = JSON.parse(row.data_json || 'null');
  } catch {
    data = null;
  }
  return {
    id: row.id,
    type: row.type as any,
    title: row.title,
    data,
    createdAt: row.created_at,
  };
}

/**
 * Save any generated study material (flashcards, mock exams, past question practice) into SQLite per user.
 */
export async function saveLocalMaterial(
  userId: string,
  material: Omit<SavedItem, 'createdAt' | 'id'> & { id?: string; createdAt?: number },
  enqueueSync: boolean = true
): Promise<string> {
  if (!userId) return '';
  const id = material.id || generateLocalId('mat');
  const now = material.createdAt || Date.now();
  const dataJson = JSON.stringify(material.data ?? null);
  const syncStatus = enqueueSync ? 'pending' : 'synced';

  const sql = `
    INSERT OR REPLACE INTO user_materials (id, user_id, type, title, data_json, created_at, sync_status, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `;

  await runStatement(sql, [
    id,
    userId,
    material.type,
    material.title,
    dataJson,
    now,
    syncStatus,
  ]);

  if (enqueueSync) {
    await enqueueSyncAction('history', id, 'create', {
      id,
      user_id: userId,
      type: material.type,
      title: material.title,
      data: material.data,
      createdAt: now,
    });
  }

  return id;
}

/**
 * Fetch all saved generated materials for a user from SQLite in reverse chronological order.
 */
export async function getLocalMaterials(userId: string): Promise<SavedItem[]> {
  if (!userId) return [];
  const sql = `
    SELECT id, user_id, type, title, data_json, created_at, sync_status, is_deleted
    FROM user_materials
    WHERE user_id = ? AND is_deleted = 0
    ORDER BY created_at DESC
  `;
  const rows = await runQuery<LocalMaterialRow>(sql, [userId]);
  return rows.map(mapRowToMaterial);
}

/**
 * Fetch a single saved material by ID.
 */
export async function getLocalMaterialById(id: string): Promise<SavedItem | null> {
  if (!id) return null;
  const sql = `
    SELECT id, user_id, type, title, data_json, created_at, sync_status, is_deleted
    FROM user_materials
    WHERE id = ? AND is_deleted = 0
    LIMIT 1
  `;
  const rows = await runQuery<LocalMaterialRow>(sql, [id]);
  if (rows.length === 0) return null;
  return mapRowToMaterial(rows[0]);
}

/**
 * Soft delete a saved material from SQLite.
 */
export async function deleteLocalMaterial(id: string, userId: string): Promise<void> {
  if (!id) return;
  await runStatement(`UPDATE user_materials SET is_deleted = 1, sync_status = 'pending' WHERE id = ?`, [id]);
  await enqueueSyncAction('history', id, 'delete', { id, user_id: userId });
}

/**
 * Bulk upsert remote history materials pulled from remote DB down to local SQLite.
 */
export async function bulkUpsertRemoteMaterials(userId: string, materials: SavedItem[]): Promise<void> {
  if (!userId || !materials.length) return;
  for (const item of materials) {
    if (!item.id) continue;
    const dataJson = JSON.stringify(item.data ?? null);
    const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
    const sql = `
      INSERT INTO user_materials (id, user_id, type, title, data_json, created_at, sync_status, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, 'synced', 0)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        type = excluded.type,
        data_json = excluded.data_json,
        created_at = excluded.created_at,
        sync_status = 'synced'
    `;
    await runStatement(sql, [
      item.id,
      userId,
      item.type,
      item.title,
      dataJson,
      createdAt,
    ]);
  }
}
