import { db, get, push, query, ref, remove, serverTimestamp, set } from '@/lib/backend';
import {
  saveLocalMaterial,
  getLocalMaterials,
  deleteLocalMaterial,
  bulkUpsertRemoteMaterials,
} from "../services/materialStorageService";

export type SavedItemType = 'flashcards' | 'exam' | 'past_questions';

export interface SavedItem {
  id?: string;
  type: SavedItemType;
  title: string;
  data: any;
  createdAt: number | object;
}

/**
 * Saves a generated material to SQLite per user instantly for offline usage and syncs with remote DB.
 */
export const saveToHistory = async (
  userId: string,
  item: Omit<SavedItem, 'createdAt' | 'id'>
): Promise<string | null> => {
  if (!userId) return null;
  const now = Date.now();

  try {
    // 1. Save directly into local SQLite first for zero latency and guaranteed offline access
    const localId = await saveLocalMaterial(userId, {
      ...item,
      createdAt: now,
    }, true);

    // 2. Try to sync to remote DB if online
    if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
      return localId;
    }

    try {
      const historyRef = ref(db, `users/${userId}/history`);
      const newRef = push(historyRef);
      const dataToSave = {
        ...item,
        id: newRef.key || localId,
        createdAt: serverTimestamp(),
      };
      await set(newRef, dataToSave);
      return newRef.key || localId;
    } catch (syncErr) {
      console.warn("Remote history sync failed, preserved in local SQLite:", syncErr);
      return localId;
    }
  } catch (error) {
    console.error("Error saving to SQLite history:", error);
    return null;
  }
};

/**
 * Fetches user's history from SQLite immediately (offline support) and reconciles with remote DB when online.
 */
export const fetchHistory = async (userId: string): Promise<SavedItem[]> => {
  if (!userId) return [];
  
  // 1. Get from local SQLite first
  let localItems: SavedItem[] = [];
  try {
    localItems = await getLocalMaterials(userId);
  } catch (err) {
    console.warn("Error reading SQLite history:", err);
  }

  // 2. If offline, return local SQLite items immediately
  if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
    return localItems;
  }

  // 3. If online, fetch latest from remote DB and upsert downstream into SQLite
  try {
    const historyRef = ref(db, `users/${userId}/history`);
    const q = query(historyRef);
    const snapshot = await get(q);
    if (snapshot.exists()) {
      const data = snapshot.val();
      const remoteItems: SavedItem[] = Object.keys(data).map(key => ({
        ...data[key],
        id: key,
      }));

      // Upsert remote items down into local SQLite
      void bulkUpsertRemoteMaterials(userId, remoteItems).catch(err => {
        console.warn("Failed to bulk upsert remote history to SQLite:", err);
      });

      // Merge remote and local items (avoiding duplicates by id)
      const mergedMap = new Map<string, SavedItem>();
      for (const item of localItems) {
        if (item.id) mergedMap.set(item.id, item);
      }
      for (const item of remoteItems) {
        if (item.id) mergedMap.set(item.id, item);
      }

      const mergedList = Array.from(mergedMap.values());
      return mergedList.sort((a, b) => {
        const timeA = typeof a.createdAt === 'number' ? a.createdAt : 0;
        const timeB = typeof b.createdAt === 'number' ? b.createdAt : 0;
        return timeB - timeA;
      });
    }
  } catch (error) {
    console.warn("Remote fetch history error, using local SQLite items:", error);
  }

  return localItems;
};

/**
 * Deletes a material from local SQLite and remote DB.
 */
export const deleteFromHistory = async (userId: string, itemId: string): Promise<void> => {
  if (!userId || !itemId) return;
  try {
    await deleteLocalMaterial(itemId, userId);
    const itemRef = ref(db, `users/${userId}/history/${itemId}`);
    await remove(itemRef);
  } catch (error) {
    console.warn("Error deleting history item:", error);
  }
};
