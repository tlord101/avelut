import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function POST(req: Request) {
  try {
    const { query, courseKey, limit = 5 } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Generate embedding for the search query
    console.log(`Generating embedding for query: "${query.substring(0, 50)}..."`);
    const embeddingResponse = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: [{ parts: [{ text: query }] }]
    });
    const vectorValues = embeddingResponse.embeddings?.[0]?.values;

    if (!vectorValues) {
      throw new Error("Failed to generate embedding for the query.");
    }

    // 2. Query Pinecone
    const indexName = process.env.PINECONE_INDEX_NAME || 'avelut-textbooks';
    console.log(`Querying Pinecone index: ${indexName}`);
    const index = pc.index(indexName);

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
      score: match.score,
      text: (match.metadata?.text || match.metadata?.text_content || "") as string,
      course_name: (match.metadata?.course_name || "") as string,
      chunk_index: match.metadata?.chunk_index
    }));

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("Vector search crash event:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
