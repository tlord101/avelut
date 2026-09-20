const fs = require('fs');
const path = 'api/grok-realtime.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.VITE_XAI_API_KEY;", "const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;");

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed backend key');
