const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: 'dummy_key' });

async function run() {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: 'hello world'
    });
    console.log(Object.keys(response));
    console.log('embedding', response.embedding ? Object.keys(response.embedding) : undefined);
    console.log('embeddings', response.embeddings ? response.embeddings.length : undefined);
  } catch(e) {
    console.log("Error:", e.message);
  }
}

run();
