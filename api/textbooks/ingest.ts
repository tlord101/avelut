import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';
import { PDFParse } from 'pdf-parse';

// Use environment variables directly in the route
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Simple semantic similarity chunking utility helper
function splitIntoSemanticParagraphs(text: string, maxChunkSize: number = 1200): string[] {
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

export async function POST(req: Request) {
  try {
    const { pdfUrl, courseKey, courseName, level, semester } = await req.json();

    if (!pdfUrl || !courseKey) {
      return new Response(JSON.stringify({ error: "Missing required properties" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Fetch PDF buffer from storage
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch PDF from ${pdfUrl}: ${pdfResponse.statusText}`);
    }
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    // 2. Extract plain text
    const parser = new PDFParse({ data: pdfBuffer });
    const parsedPdf = await parser.getText();
    const rawText = parsedPdf.text;
    console.log(`Extracted ${rawText.length} characters from PDF`);

    // 3. Process Semantic Chunking
    const chunks = splitIntoSemanticParagraphs(rawText);
    console.log(`Split into ${chunks.length} chunks`);

    // 4. Generate Vector Vectors via text-embedding-004
    const indexName = process.env.PINECONE_INDEX_NAME || 'avelut-textbooks';
    const index = pc.index(indexName);
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
        await index.upsert(records as any);
        records.length = 0; // Clear array buffer array
      }
    }

    return new Response(JSON.stringify({ success: true, chunksCount: chunks.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error("Vector ingestion crash event:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
