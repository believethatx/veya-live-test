import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry } from './rooms.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'public');
const rooms = new RoomRegistry();
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };
const send = (socket, value) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ rooms: rooms.list() })); return;
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
  const expected = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
  if (req.url !== '/signal' || origin !== expected) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', socket => {
  let lastChat = 0;
  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { send(socket, { type: 'error', message: 'Invalid message' }); return; }
    try {
      if (msg.type === 'create') {
        const room = rooms.create(socket, msg.title, msg.category);
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
        for (const peer of [entry.room.host, entry.room.viewer]) send(peer, { type: 'chat', role: entry.role, text });
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
