const { Pinecone } = require('@pinecone-database/pinecone');
async function run() {
  const pc = new Pinecone({ apiKey: 'dummy-api-key-test-abc' });
  const idx = pc.index('test');
  try {
    await idx.upsert([{ id: '1', values: [] }]);
  } catch(e) {
    console.error('Error:', e.message);
  }
}
run();
