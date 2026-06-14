import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';

interface SearchResult {
  score: number;
  text: string;
  course_name: string;
  chunk_index?: number;
}

/**
 * Perform a vector search on the Pinecone index using client-side genAI embeddings.
 */
export async function searchPinecone(
  query: string,
  courseKey: string | undefined,
  limit: number,
  appSettings: any
): Promise<{ success: boolean; results?: SearchResult[]; message?: string }> {
  try {
    if (!query) {
      return { success: false, message: "Missing query" };
    }

    const pineconeApiKey = appSettings?.pinecone_api_key;
    const pineconeIndexName = appSettings?.pinecone_index_name || 'avelut-textbooks';
    const geminiApiKey = appSettings?.gemini_api_key;

    if (!pineconeApiKey || !geminiApiKey) {
      return { success: false, message: "Pinecone or Gemini API key is missing in App Controls." };
    }

    const pc = new Pinecone({ apiKey: pineconeApiKey });
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    // 1. Generate embedding for the search query
    const embeddingResponse = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: [{ parts: [{ text: query }] }]
    });
    
    const vectorValues = embeddingResponse.embeddings?.[0]?.values;

    if (!vectorValues) {
      return { success: false, message: "Failed to generate embedding for the query." };
    }

    // 2. Query Pinecone
    const index = pc.index(pineconeIndexName);

    const filter: any = {};
    if (courseKey) {
        filter.course_key = courseKey;
    }

    const queryResponse = await index.query({
      vector: vectorValues,
      topK: limit,
      includeMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined
    });

    const results = queryResponse.matches.map(match => ({
      score: match.score || 0,
      text: (match.metadata?.text || match.metadata?.text_content || "") as string,
      course_name: (match.metadata?.course_name || "") as string,
      chunk_index: match.metadata?.chunk_index as number | undefined
    }));

    return { success: true, results };
  } catch (error: any) {
    console.error("Vector search crash event:", error);
    return { success: false, message: error.message || "An unknown error occurred during vector search." };
  }
}

/**
 * Split text into semantic chunks for ingestion.
 */
export function splitIntoSemanticParagraphs(text: string, maxChunkSize: number = 1200): string[] {
  // Split by clean sentence terminations
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
    currentChunk += sentence;
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

/**
 * Ingest extracted raw text into Pinecone.
 */
export async function ingestTextToPinecone(
  rawText: string,
  courseKey: string,
  courseName: string,
  level: string,
  semester: string,
  appSettings: any,
  onProgress?: (progress: string) => void
): Promise<{ success: boolean; chunksCount?: number; message?: string }> {
  try {
    const pineconeApiKey = appSettings?.pinecone_api_key;
    const pineconeIndexName = appSettings?.pinecone_index_name || 'avelut-textbooks';
    const geminiApiKey = appSettings?.gemini_api_key;

    if (!pineconeApiKey || !geminiApiKey) {
      return { success: false, message: "Pinecone or Gemini API key is missing in App Controls." };
    }

    const pc = new Pinecone({ apiKey: pineconeApiKey });
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const chunks = splitIntoSemanticParagraphs(rawText);
    if (onProgress) onProgress(`Split text into ${chunks.length} chunks. Generating embeddings...`);

    const index = pc.index(pineconeIndexName);
    const records = [];

    for (let i = 0; i < chunks.length; i++) {
      const textChunk = chunks[i];

      // Request vector coordinates from Google
      const embeddingResponse = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ parts: [{ text: textChunk }] }]
      });

      const vectorValues = embeddingResponse.embeddings?.[0]?.values;
      if (!vectorValues) continue;

      records.push({
        id: `${courseKey}_chunk_${i}`,
        values: vectorValues,
        metadata: {
          course_key: courseKey,
          course_name: courseName || "",
          level: level || "",
          semester: semester || "",
          chunk_index: i,
          text: textChunk
        }
      });

      // Upsert in safe batch limits of 100 entries
      if (records.length === 100 || i === chunks.length - 1) {
        if (onProgress) onProgress(`Upserting chunks batch to Pinecone (${i + 1}/${chunks.length})...`);
        await index.upsert(records as any);
        records.length = 0; // Clear array buffer
      }
    }

    return { success: true, chunksCount: chunks.length };
  } catch (error: any) {
    console.error("Vector ingestion crash event:", error);
    return { success: false, message: error.message || "An unknown error occurred during vector ingestion." };
  }
}
