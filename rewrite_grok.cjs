const fs = require('fs');

const path = 'services/grok_realtime/GrokRealtimeTeacher.ts';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: Pass the token in a protocol query parameter or WebSockets header workaround,
// OR the better way: proxy the WebSocket through our backend so we don't need to do auth on the client.
// Actually, standard OpenAI realtime pattern for browsers uses WebRTC. The prompt asked for websockets. Let's proxy through api.
// Actually, since this is a proxy file, let's fix the Base64 encoding.

content = content.replace(
  "const uint8Array = new Uint8Array(buffer);\n        let binary = '';\n        for (let i = 0; i < uint8Array.length; i++) {\n          binary += String.fromCharCode(uint8Array[i]);\n        }",
  "const uint8Array = new Uint8Array(buffer);\n        // Fast base64 without loop blocking\n        const binary = Array.from(uint8Array).map(b => String.fromCharCode(b)).join('');"
);
// Still somewhat slow, let's use chunking or btoa(String.fromCharCode.apply(null, uint8Array)) but avoid stack overflow
content = content.replace(
  "const uint8Array = new Uint8Array(buffer);\n        // Fast base64 without loop blocking\n        const binary = Array.from(uint8Array).map(b => String.fromCharCode(b)).join('');",
  "const uint8Array = new Uint8Array(buffer);\n        // Fast base64 conversion\n        const chunks = [];\n        for (let i = 0; i < uint8Array.length; i += 8192) {\n          chunks.push(String.fromCharCode.apply(null, Array.from(uint8Array.subarray(i, i + 8192))));\n        }\n        const binary = chunks.join('');"
);

// We still need to fix the auth issue. Since we can't send headers in browser WS,
// let's pass the token in the URL or proxy. We fetched an ephemeral token `clientSecret`.
// If Grok follows OpenAI, we can't use headers. But if we must use our proxy, let's change the WS URL.
// The easiest fix that doesn't require setting up a full WS proxy backend is using WebRTC if Grok supports it, OR passing the token in the URL.
// But the backend `api/grok-realtime.ts` already fetches the session token.
// Let's proxy the WebSocket through our own backend.
// No, the instructions are to integrate Grok realtime voice.
// For now, let's send the token via standard WebSocket subprotocol.
content = content.replace(
  "const url = \`wss://api.x.ai/v1/realtime?model=grok-realtime\`;\n      this.ws = new WebSocket(url);",
  "const url = \`wss://api.x.ai/v1/realtime?model=grok-realtime\`;\n      // WebSockets in browser can't set headers, so we pass the token in the subprotocols array\n      this.ws = new WebSocket(url, ['realtime', \`bearer-\${clientSecret}\`, \`openai-insecure-api-key.\${clientSecret}\`]);"
);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed performance issue and added token to subprotocol');
