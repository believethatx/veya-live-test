import { WebSocket } from 'ws';
import { strict as assert } from 'node:assert';

const base = 'http://127.0.0.1:31047';
const connect = () => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:31047/signal', { headers: { Origin: base, Host: '127.0.0.1:31047' } });
  ws.once('open', () => resolve(ws)); ws.once('error', reject);
});
const next = (socket, type) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error(`Timed out waiting for ${type}`)), 3000);
  const listener = raw => {
    const value = JSON.parse(raw);
    if (value.type !== type) return;
    clearTimeout(timeout); socket.off('message', listener); resolve(value);
  };
  socket.on('message', listener);
});

const host = await connect();
const created = next(host, 'created');
host.send(JSON.stringify({ type: 'create', title: 'Real test room', category: 'Chat' }));
const { room } = await created;
const response = await fetch(`${base}/api/rooms`);
assert.equal((await response.json()).rooms[0].id, room.id);
const viewer = await connect();
const joined = next(viewer, 'joined'); const peerJoined = next(host, 'peer-joined');
viewer.send(JSON.stringify({ type: 'join', roomId: room.id }));
await Promise.all([joined, peerJoined]);
const chat = next(viewer, 'chat');
host.send(JSON.stringify({ type: 'chat', text: 'Hello live room' }));
assert.equal((await chat).text, 'Hello live room');
const ended = next(viewer, 'ended'); host.close(); await ended;
assert.equal((await (await fetch(`${base}/api/rooms`)).json()).rooms.length, 0);
viewer.close(); console.log('PASS: real host, viewer, chat, and room cleanup');
