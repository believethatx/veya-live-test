import { randomBytes } from 'node:crypto';

const categories = new Set(['Chat', 'Music', 'Gaming', 'Other']);
const id = () => randomBytes(12).toString('hex');

export class RoomRegistry {
  constructor() { this.rooms = new Map(); this.peers = new Map(); }
  list() {
    return [...this.rooms.values()].map(r => ({ id: r.id, title: r.title, category: r.category, viewers: r.viewer ? 1 : 0, startedAt: r.startedAt }));
  }
  create(socket, title, category) {
    if (this.peers.has(socket)) throw new Error('Already in a room');
    title = String(title ?? '').trim().slice(0, 70);
    if (title.length < 3) throw new Error('Enter a room title');
    if (!categories.has(category)) throw new Error('Choose a valid category');
    const room = { id: id(), title, category, startedAt: new Date().toISOString(), host: socket, viewer: null };
    this.rooms.set(room.id, room); this.peers.set(socket, { room, role: 'host' });
    return room;
  }
  join(socket, roomId) {
    if (this.peers.has(socket)) throw new Error('Already in a room');
    const room = this.rooms.get(String(roomId));
    if (!room) throw new Error('This room has ended');
    if (room.viewer) throw new Error('This test room is full');
    room.viewer = socket; this.peers.set(socket, { room, role: 'viewer' });
    return room;
  }
  peer(socket) { return this.peers.get(socket); }
  other(socket) {
    const entry = this.peer(socket);
    return entry && (entry.role === 'host' ? entry.room.viewer : entry.room.host);
  }
  leave(socket) {
    const entry = this.peers.get(socket);
    if (!entry) return null;
    this.peers.delete(socket);
    if (entry.role === 'host') {
      this.rooms.delete(entry.room.id);
      if (entry.room.viewer) this.peers.delete(entry.room.viewer);
    } else entry.room.viewer = null;
    return entry;
  }
}
