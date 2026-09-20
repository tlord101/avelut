const WebSocket = require('ws');
const ws = new WebSocket('wss://api.x.ai/v1/realtime');
ws.on('open', () => console.log('OPEN'));
ws.on('error', (e) => console.log('ERR', e.message));
ws.on('close', (c) => console.log('CLOSE', c));
