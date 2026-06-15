const { Pinecone } = require('@pinecone-database/pinecone');

const pc = new Pinecone({ apiKey: 'dummy-key' });
const idx = pc.index('dummy-index');

async function testUpsert(records) {
  try {
    await idx.upsert(records);
    console.log('Upsert call passed validation (failed at network, which is fine)');
  } catch(e) {
    console.error('Error with records:', JSON.stringify(records), '->', e.message);
  }
}

async function run() {
  await testUpsert([{ id: '1', values: [0.1, 0.2] }]);
  await testUpsert([{ id: '1', values: [] }]);
  await testUpsert([{ id: '1', values: [0.1], metadata: { key: undefined } }]);
  await testUpsert([{ id: '1', values: [0.1], metadata: { key: null } }]);
  await testUpsert([{ id: '1', values: [0.1], metadata: { text: "valid", empty: "" } }]);
  
  // What if Pinecone drops records that are missing some property or have weird types?
  await testUpsert([{ id: '1', values: [NaN, 0.1] }]);
}

run();
