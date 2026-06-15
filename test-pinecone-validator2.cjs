const { Pinecone } = require('@pinecone-database/pinecone');

const pc = new Pinecone({ apiKey: 'dummy-key' });
const idx = pc.index('dummy-index');

async function testUpsert(options) {
  try {
    await idx.upsert(options);
    console.log('Upsert call passed validation (failed at network, which is fine)');
  } catch(e) {
    console.error('Error with options:', JSON.stringify(options), '->', e.message);
  }
}

async function run() {
  await testUpsert([{ id: '1', values: [0.1, 0.2] }]);
  await testUpsert({ records: [{ id: '1', values: [0.1, 0.2] }] });
}

run();
