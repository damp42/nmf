// NoMoreForms — single Node service
// Serves the static form/app pages AND hosts the blind WebSocket relay, from one
// process on one host (Render). Same-origin, so wss:// needs no CORS.
//
// The relay is provably blind: it routes by session ID only and NEVER parses or
// logs message content — only session IDs, connect/disconnect events, and byte sizes.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RELAY_PATH = '/api/relay';

// ---- Static file serving -------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

function safeJoin(base, target) {
  // Prevent path traversal — resolved path must stay under base.
  const p = path.normalize(path.join(base, target));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';

  let filePath = safeJoin(PUBLIC_DIR, pathname);
  if (!filePath) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 — Not Found</h1>');
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ---- Blind WebSocket relay ----------------------------------------------

// sessionId -> Set<WebSocket>
const sessions = new Map();

const wss = new WebSocketServer({ server, path: RELAY_PATH });

wss.on('connection', (socket, req) => {
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('session');
  if (!sessionId) {
    console.log('[relay] connection rejected — no session id');
    socket.close(1008, 'session required');
    return;
  }

  if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
  const peers = sessions.get(sessionId);
  peers.add(socket);
  console.log(`[relay] connect    session=${sessionId} peers=${peers.size}`);

  socket.on('message', (data, isBinary) => {
    // NEVER inspect or log content — only its size. Forward verbatim to other peers,
    // preserving the sender's frame type (our protocol is JSON text, so text stays text
    // and the browser receives a string rather than a Blob).
    const bytes = data.length ?? data.byteLength ?? 0;
    let forwarded = 0;
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary });
        forwarded++;
      }
    }
    console.log(`[relay] forward    session=${sessionId} bytes=${bytes} -> ${forwarded} peer(s)`);
  });

  socket.on('close', () => {
    peers.delete(socket);
    console.log(`[relay] disconnect session=${sessionId} peers=${peers.size}`);
    if (peers.size === 0) sessions.delete(sessionId);
  });

  socket.on('error', (e) => {
    console.log(`[relay] error      session=${sessionId} ${e.message}`);
  });
});

server.listen(PORT, () => {
  console.log(`NoMoreForms running on http://localhost:${PORT}`);
  console.log(`  form:  http://localhost:${PORT}/form/`);
  console.log(`  app:   http://localhost:${PORT}/app/`);
  console.log(`  relay: ws://localhost:${PORT}${RELAY_PATH}?session=<id>`);
});
