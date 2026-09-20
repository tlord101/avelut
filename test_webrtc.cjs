const fetch = require('node-fetch');

// This uses OpenAI's WebRTC style, let's see if x.ai supports it
fetch("https://api.x.ai/v1/realtime", {
  method: "POST",
  headers: {
    "Authorization": "Bearer TEST",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "grok-realtime"
  })
}).then(res => res.json()).then(console.log).catch(console.error);
