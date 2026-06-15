const { Pinecone } = require('@pinecone-database/pinecone');

const pc = new Pinecone({ apiKey: 'dummy-key' });
const idx = pc.index('dummy-index');

async function run() {
  try {
    await idx.upsert([{ id: '1', values: [0.1, 0.2] }]);
  } catch(e) {
    console.error(e.stack);
  }
}

run();
