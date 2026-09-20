import WebSocket from 'ws';

const ws = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-realtime', {
  headers: {
    "Authorization": "Bearer TEST",
  }
});
ws.on('open', () => {
  console.log('OPEN');
  ws.close();
});
ws.on('error', (e) => console.log('ERR', e.message));
ws.on('close', (c, r) => console.log('CLOSE', c, r.toString()));
