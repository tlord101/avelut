const { OpenAI } = require('openai');
const client = new OpenAI({
    apiKey: "test",
    baseURL: "https://api.x.ai/v1"
});

console.log("no WebRTC in this test");
