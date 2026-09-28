import { Pinecone } from '@pinecone-database/pinecone';

export interface MemoryVectorPayload {
  action: 'query' | 'upsert' | 'delete';
  userId: string;
  queryText?: string;
  topK?: number;
  memoryItem?: {
    id: string;
    category: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    enabled: boolean;
  };
  memoryId?: string;
}

/**
 * Server-side helper to create text embedding vector.
 */
function generateTextEmbeddingVector(text: string, dimensions = 1536): number[] {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = (hash << 5) - hash + word.charCodeAt(j);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0 / Math.sqrt(words.length);
  }
  let norm = 0;
  for (let k = 0; k < dimensions; k++) norm += vector[k] * vector[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < dimensions; k++) vector[k] /= norm;
  return vector;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'PINECONE_UNAVAILABLE', message: 'Pinecone API key not configured on server' });
  }

  const { action, userId, queryText, topK = 5, memoryItem, memoryId } = (req.body || {}) as MemoryVectorPayload;

  if (!userId) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing userId parameter' });
  }

  try {
    const pc = new Pinecone({ apiKey });
    const indexName = process.env.PINECONE_INDEX_NAME || 'avelut-textbooks';
    const index = pc.index(indexName);

    // User-scoped namespace for strict memory isolation
    const userNamespace = index.namespace(`user_${userId}`);

    if (action === 'query') {
      if (!queryText) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing queryText' });
      }
      const vector = generateTextEmbeddingVector(queryText);
      const queryResponse = await userNamespace.query({
        vector,
        topK: Math.min(topK, 10),
        includeMetadata: true,
        filter: { user_id: userId },
      });

      const matches = (queryResponse.matches || [])
        .filter((m) => (m.score || 0) >= 0.25)
        .map((m) => ({
          score: m.score || 0,
          id: m.id,
          content: m.metadata?.content || '',
          category: m.metadata?.category || 'preference',
          enabled: m.metadata?.enabled !== false,
        }));

      return res.status(200).json({ success: true, matches });
    }

    if (action === 'upsert') {
      if (!memoryItem || !memoryItem.id || !memoryItem.content) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing memoryItem details' });
      }
      const vector = generateTextEmbeddingVector(memoryItem.content);
      await userNamespace.upsert({
        records: [
          {
            id: memoryItem.id,
            values: vector,
            metadata: {
              user_id: userId,
              memory_id: memoryItem.id,
              category: memoryItem.category,
              content: memoryItem.content,
              createdAt: memoryItem.createdAt,
              updatedAt: memoryItem.updatedAt,
              enabled: memoryItem.enabled,
            },
          },
        ],
      });
      return res.status(200).json({ success: true, id: memoryItem.id });
    }

    if (action === 'delete') {
      if (!memoryId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing memoryId' });
      }
      await userNamespace.deleteOne(memoryId);
      return res.status(200).json({ success: true, id: memoryId });
    }

    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Unknown action' });
  } catch (err: any) {
    console.error('[ai-memory API] Error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message || 'Internal server error' });
  }
}
