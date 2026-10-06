import { randomBytes } from 'node:crypto';
const categories = new Set(['Chat', 'Music', 'Gaming', 'Other']);
export class RoomRegistry {
  constructor() { this.rooms = new Map(); this.peers = new Map(); }
  list() {
    return [...this.rooms.values()].filter(r => r.live).map(r => ({
      id: r.id, title: r.title, category: r.category, hostName: r.hostName,
      viewers: [...r.viewers].filter(s => this.peers.get(s)?.ready).length, startedAt: r.startedAt,
    }));
  }
  create(socket, title, category) {
    this.assertFree(socket);
    title = String(title ?? '').trim().slice(0, 70);
    if (title.length < 3) throw Error('Enter a room title');
    if (!categories.has(category)) throw Error('Choose a valid category');
    const room = { id: randomBytes(12).toString('hex'), title, category,
      hostName: socket.user.displayName, hostId: socket.user.id,
      startedAt: new Date().toISOString(), host: socket, viewers: new Set(), blocked: new Set(), live: false };
    this.rooms.set(room.id, room); this.peers.set(socket, { room, role: 'host', ready: false });
    return room;
  }
  assertFree(socket) {
    if (this.peers.has(socket) || [...this.peers.keys()].some(s => s.user.id === socket.user.id)) throw Error('You are already in a room on another tab or device');
  }
  join(socket, roomId) {
    this.assertFree(socket);
    const room = this.rooms.get(String(roomId));
    if (!room?.live) throw Error('This room is not live');
    if (room.blocked.has(socket.user.id)) throw Error('You have been removed from this room');
    if (room.viewers.size >= 50) throw Error('This room is full');
    room.viewers.add(socket); this.peers.set(socket, { room, role: 'viewer', ready: false });
    return room;
  }
  ready(socket) {
    const entry = this.peers.get(socket);
    if (!entry) throw Error('Join a room first');
    entry.ready = true;
    if (entry.role === 'host') entry.room.live = true;
    return entry;
  }
  peer(socket) { return this.peers.get(socket); }
  participants(room) { return [room.host, ...room.viewers]; }
  kick(socket, userId) {
    const entry = this.peer(socket);
    if (entry?.role !== 'host') throw Error('Only the host can remove viewers');
    const target = [...entry.room.viewers].find(s => s.user.id === userId);
    if (!target) throw Error('Viewer not found');
    entry.room.blocked.add(userId); this.leave(target); return target;
  }
  leave(socket) {
    const entry = this.peers.get(socket);
    if (!entry) return null;
    this.peers.delete(socket);
    if (entry.role === 'host') {
      this.rooms.delete(entry.room.id);
      for (const viewer of entry.room.viewers) this.peers.delete(viewer);
    } else entry.room.viewers.delete(socket);
    return entry;
  }
}
