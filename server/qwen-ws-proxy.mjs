#!/usr/bin/env node
/**
 * server/qwen-ws-proxy.mjs
 *
 * WebSocket proxy for Alibaba Cloud DashScope Qwen Omni Realtime.
 * Model: Qwen3.8-Omni-Flash-Realtime
 * To update the model, change QWEN_REALTIME_MODEL here and in api/qwen-realtime.ts.
 *
 * WHY THIS EXISTS:
 *   The browser WebSocket API cannot send custom HTTP headers.
 *   DashScope requires "Authorization: Bearer <key>" on the upgrade handshake.
 *   This proxy runs server-side where we can inject the header freely.
 *
 * HOW IT WORKS:
 *   Browser → ws://localhost:3001/qwen-realtime  (no auth required from browser)
 *   Proxy   → wss://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/...
 *             (with Authorization: Bearer header injected)
 *   All messages are piped bidirectionally, zero transformation.
 *
 * RUNNING:
 *   ALIBABA_API_KEY=sk-... node server/qwen-ws-proxy.mjs
 *
 * PORT: 3001 (configurable via PORT_WS env var)
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT_WS || '3001', 10);
const API_KEY = process.env.ALIBABA_API_KEY || process.env.VITE_ALIBABA_API_KEY || '';
const WORKSPACE_ID = process.env.ALIBABA_WORKSPACE_ID || 'ws-o3v6mh0i8y9tqdfx';
// Keep in sync with QWEN_REALTIME_MODEL in QwenRealtimeTeacherService.ts and api/qwen-realtime.ts
const QWEN_REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';

function getDashScopeUrl(targetModel) {
  const model = (targetModel || process.env.QWEN_REALTIME_MODEL || QWEN_REALTIME_MODEL).trim();
  return (
    `wss://${WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com` +
    `/api-ws/v1/realtime?model=${model}`
  );
}

if (!API_KEY) {
  console.error('[qwen-ws-proxy] ❌  ALIBABA_API_KEY is not set. Export it before starting.');
  process.exit(1);
}

// ── HTTP server (for health checks) ─────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'qwen-ws-proxy', port: PORT }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ── WebSocket proxy server ───────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/qwen-realtime' });

wss.on('connection', (clientSocket, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const clientRequestedModel = parsedUrl.searchParams.get('model');
  const upstreamUrl = getDashScopeUrl(clientRequestedModel);

  console.log(`[qwen-ws-proxy] 🔗 Client connected from ${clientIp} (model: ${clientRequestedModel || QWEN_REALTIME_MODEL})`);

  // Open the upstream DashScope connection with proper Authorization header
  const upstreamSocket = new WebSocket(upstreamUrl, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'X-DashScope-WorkSpace': WORKSPACE_ID,
      'User-Agent': 'Avelut-LiveTeacher/1.0',
    },
  });

  let clientClosed = false;
  let upstreamClosed = false;
  const clientQueue = [];

  // ── Upstream → Client pipe ──────────────────────────────────────────────
  upstreamSocket.on('open', () => {
    console.log('[qwen-ws-proxy] ✅ Upstream DashScope connected');
    while (clientQueue.length > 0) {
      const item = clientQueue.shift();
      if (item && upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(item.data, { binary: item.isBinary });
      }
    }
  });

  upstreamSocket.on('message', (data, isBinary) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data, { binary: isBinary });
    }
  });

  upstreamSocket.on('error', (err) => {
    console.error('[qwen-ws-proxy] ⛔ Upstream error:', err.message);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(1011, 'Upstream error');
    }
  });

  upstreamSocket.on('close', (code, reason) => {
    console.log(`[qwen-ws-proxy] 🔌 Upstream closed (${code})`);
    upstreamClosed = true;
    if (!clientClosed && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason);
    }
  });

  // ── Client → Upstream pipe ──────────────────────────────────────────────
  clientSocket.on('message', (data, isBinary) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.send(data, { binary: isBinary });
    } else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      clientQueue.push({ data, isBinary });
    }
  });

  clientSocket.on('error', (err) => {
    console.error('[qwen-ws-proxy] ⛔ Client error:', err.message);
    if (!upstreamClosed && upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.close(1011, 'Client error');
    }
  });

  clientSocket.on('close', (code, reason) => {
    console.log(`[qwen-ws-proxy] 👋 Client disconnected (${code})`);
    clientClosed = true;
    if (!upstreamClosed && upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.close(code, reason);
    }
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[qwen-ws-proxy] 🚀 Proxy running on ws://localhost:${PORT}/qwen-realtime`);
  console.log(`[qwen-ws-proxy]    Forwarding → ${DASHSCOPE_WS_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[qwen-ws-proxy] SIGTERM received, shutting down...');
  wss.close();
  httpServer.close();
});

