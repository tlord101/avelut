const WebSocket = require('ws');

const ws = new WebSocket('wss://api.x.ai/v1/realtime', {
  headers: {
    "Authorization": "Bearer TEST"
  }
});
ws.on('open', () => {
  console.log('OPEN');
  ws.close();
});
ws.on('error', (e) => console.log('ERR', e.message));
ws.on('close', (c) => console.log('CLOSE', c));
