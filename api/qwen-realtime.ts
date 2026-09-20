/**
 * api/qwen-realtime.ts
 *
 * Vercel Node.js Serverless Function — WebSocket Proxy for DashScope Realtime.
 *
 * WHY:
 *   The browser WebSocket API cannot send custom HTTP headers.
 *   DashScope requires "Authorization: Bearer <key>" on the WS handshake.
 *   This function runs on the server where we can inject that header freely.
 *
 * WORKS FOR:
 *   - Web app:          /api/qwen-realtime        (same-origin, relative path)
 *   - Capacitor mobile: wss://www.avelut.xyz/api/qwen-realtime (absolute URL)
 *   - Local dev:        Vite proxies /api/qwen-realtime → localhost:3001
 *
 * RUNTIME:
 *   Node.js (not Edge) — required for WebSocket upgrade via req.socket.
 *   maxDuration = 300s on Vercel Pro. Sessions auto-reconnect beyond that.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';

// ── Vercel config: Node.js runtime, 5-min max (Pro tier) ─────────────────────
export const config = {
  api: { bodyParser: false },
  runtime: 'nodejs',
};

export const maxDuration = 300;

// ── DashScope upstream ────────────────────────────────────────────────────────
const WORKSPACE_ID =
  process.env.ALIBABA_WORKSPACE_ID || 'ws-o3v6mh0i8y9tqdfx';
const DASHSCOPE_URL =
  `wss://${WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com` +
  `/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime`;

// ── Singleton WSS (reused across warm invocations) ────────────────────────────
const wss = new WebSocketServer({ noServer: true });

// ── Handler ───────────────────────────────────────────────────────────────────
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const apiKey =
    process.env.ALIBABA_API_KEY ||
    process.env.VITE_ALIBABA_API_KEY ||
    '';

  // ── Health check (GET without Upgrade header) ────────────────────────────
  if (req.method === 'GET' && req.headers.upgrade?.toLowerCase() !== 'websocket') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', endpoint: 'qwen-realtime-proxy' }));
    return;
  }

  // ── Guard: key must be configured on the server ──────────────────────────
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ALIBABA_API_KEY is not configured on the server.' }));
    return;
  }

  // ── Must be a WebSocket upgrade request ─────────────────────────────────
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
    res.writeHead(426, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'WebSocket upgrade required.' }));
    return;
  }

  // ── Perform the WebSocket upgrade and proxy ──────────────────────────────
  const socket = req.socket as Socket;
  const head = Buffer.alloc(0);

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    // Open the upstream connection to DashScope — with the auth header injected
    const upstream = new WebSocket(DASHSCOPE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-WorkSpace': WORKSPACE_ID,
        'User-Agent': 'Avelut-LiveTeacher/1.0 (Vercel)',
      },
    });

    let clientDone = false;
    let upstreamDone = false;

    // ── Upstream → Client ──────────────────────────────────────────────────
    upstream.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    upstream.on('error', (err) => {
      console.error('[qwen-realtime] Upstream error:', err.message);
      if (!clientDone && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, 'Upstream error');
      }
    });

    upstream.on('close', (code, reason) => {
      upstreamDone = true;
      if (!clientDone && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason);
      }
    });

    // ── Client → Upstream ──────────────────────────────────────────────────
    clientWs.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });

    clientWs.on('error', (err) => {
      console.error('[qwen-realtime] Client error:', err.message);
      if (!upstreamDone && upstream.readyState === WebSocket.OPEN) {
        upstream.close(1011, 'Client error');
      }
    });

    clientWs.on('close', (code, reason) => {
      clientDone = true;
      if (!upstreamDone && upstream.readyState === WebSocket.OPEN) {
        upstream.close(code, reason);
      }
    });
  });
}

