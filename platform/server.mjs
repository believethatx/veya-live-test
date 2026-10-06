import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry } from './rooms.mjs';
import { register, login, createSession, userFromRequest, revokeSession, sessionCookie, expiredCookie } from './auth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'public');
const rooms = new RoomRegistry();
const attempts = new Map();
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };
const send = (socket, value) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
const secureRequest = req => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
const requestOrigin = req => `${secureRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Error('JSON body required');
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error('Request too large'); }
  return JSON.parse(body);
}
function json(res, code, value, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
const server = createServer(async (req, res) => {
  if (req.url === '/api/me' && req.method === 'GET') {
    json(res, 200, { user: userFromRequest(req) }); return;
  }
  if (req.url?.startsWith('/api/') && req.method === 'POST') {
    if (req.headers.origin !== requestOrigin(req)) { json(res, 403, { error: 'Invalid origin' }); return; }
    try {
      if (req.url === '/api/logout') {
        revokeSession(req); json(res, 200, { ok: true }, { 'Set-Cookie': expiredCookie }); return;
      }
      if (!['/api/register', '/api/login'].includes(req.url)) { json(res, 404, { error: 'Not found' }); return; }
      const ip = req.socket.remoteAddress || 'unknown';
      const history = (attempts.get(ip) || []).filter(time => Date.now() - time < 60_000);
      if (history.length >= 8) { json(res, 429, { error: 'Too many attempts. Wait a minute.' }); return; }
      history.push(Date.now()); attempts.set(ip, history);
      const input = await jsonBody(req);
      const user = req.url === '/api/register' ? register(input) : login(input);
      const token = createSession(user.id);
      json(res, 200, { user }, { 'Set-Cookie': sessionCookie(token, secureRequest(req)) }); return;
    } catch (error) {
      json(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON' : error.message }); return;
    }
  }
  if (req.method === 'GET' && req.url === '/api/rooms') {
    json(res, 200, { rooms: rooms.list() }); return;
  }
  const path = req.url?.split('?')[0];
  if (req.method !== 'GET' || !files[path]) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const [file, type] = files[path];
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(500); res.end('Unable to load app'); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const user = userFromRequest(req);
  if (req.url !== '/signal' || origin !== requestOrigin(req) || !user) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { ws.user = user; wss.emit('connection', ws); });
});
wss.on('connection', socket => {
  let lastChat = 0;
  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { send(socket, { type: 'error', message: 'Invalid message' }); return; }
    try {
      if (msg.type === 'create') {
        const room = rooms.create(socket, msg.title, msg.category, socket.user.displayName);
        send(socket, { type: 'created', room: { id: room.id, title: room.title } }); return;
      }
      if (msg.type === 'join') {
        const room = rooms.join(socket, msg.roomId);
        send(socket, { type: 'joined', room: { id: room.id, title: room.title } });
        send(room.host, { type: 'peer-joined' }); return;
      }
      const entry = rooms.peer(socket);
      if (!entry) throw new Error('Join a room first');
      if (msg.type === 'signal') {
        if (!['offer', 'answer', 'candidate'].includes(msg.data?.type)) throw new Error('Invalid signal');
        send(rooms.other(socket), { type: 'signal', data: msg.data }); return;
      }
      if (msg.type === 'chat') {
        if (Date.now() - lastChat < 800) throw new Error('Please slow down');
        const text = String(msg.text ?? '').trim().slice(0, 280);
        if (!text) return;
        lastChat = Date.now();
        for (const peer of [entry.room.host, entry.room.viewer]) send(peer, { type: 'chat', name: socket.user.displayName, text });
        return;
      }
      if (msg.type === 'leave') socket.close(1000, 'Left room');
    } catch (error) { send(socket, { type: 'error', message: error.message }); }
  });
  socket.on('close', () => {
    const peer = rooms.other(socket); const entry = rooms.leave(socket);
    if (entry?.role === 'host') { send(peer, { type: 'ended' }); peer?.close(1000, 'Room ended'); }
    else if (entry) send(peer, { type: 'peer-left' });
  });
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Veya alpha server ready'));
