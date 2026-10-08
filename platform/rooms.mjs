import { randomBytes } from 'node:crypto';
export class RoomRegistry {
  constructor() { this.rooms = new Map(); this.peers = new Map(); }
  list() {
    return [...this.rooms.values()].filter(r => r.live).map(r => ({
      id: r.id, title: r.title, hostId:r.hostId, hostName: r.hostName, hostAvatar: r.host.user.avatar || '',
      viewers: [...r.viewers].filter(s => this.peers.get(s)?.ready && s!==r.guest).length, guestName:r.guest?.user.displayName||null, startedAt: r.startedAt,
    }));
  }
  create(socket, title) {
    this.assertFree(socket);
    title = String(title ?? '').trim().slice(0, 70);
    if (title.length < 3) throw Error('Enter a room title with at least 3 characters');
    const room = { id: randomBytes(12).toString('hex'), title,
      hostName: socket.user.displayName, hostId: socket.user.id,
      startedAt: new Date().toISOString(), host: socket, viewers: new Set(), blocked: new Set(), live: false, guest:null,guestInvite:null,battle:null };
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
  inviteGuest(host, userId, eligible) {
    const entry=this.peer(host),room=entry?.room;
    if(entry?.role!=='host'||!room.live)throw Error('Only the live host can invite a guest');
    if(room.guest)throw Error('A guest is already on camera');
    const target=[...room.viewers].find(s=>s.user.id===userId && this.peer(s)?.ready);
    if(!target)throw Error('That person is not watching this live');
    if(!eligible(target.user,target.request))throw Error('Only an approved host can join on camera');
    if(room.guestInvite && room.guestInvite.expires>Date.now())throw Error('Wait for the current invitation to finish');
    room.guestInvite={socket:target,expires:Date.now()+30_000};return target;
  }
  acceptGuest(socket,accept) {
    const entry=this.peer(socket),room=entry?.room,invite=room?.guestInvite;
    if(!invite||invite.socket!==socket||invite.expires<Date.now()||entry.role!=='viewer')throw Error('Guest invitation has expired');
    if(typeof accept!=='boolean')throw Error('Accept or decline the invitation');
    room.guestInvite=null;
    if(accept){if(room.guest)throw Error('A guest is already on camera');room.guest=socket;entry.role='cohost';}
    return {room,accepted:accept};
  }
  removeGuest(host) {
    const entry=this.peer(host),room=entry?.room;
    if(!['host','cohost'].includes(entry?.role)||!room.guest||(entry.role==='cohost'&&room.guest!==host))throw Error('There is no guest to remove');
    const guest=room.guest;room.lastGuestName=guest.user.displayName;room.guest=null;this.peer(guest).role='viewer';return guest;
  }
  startBattle(host){const entry=this.peer(host),room=entry?.room;if(entry?.role!=='host'||!room.guest||!this.peer(room.guest)?.ready)throw Error('Invite a guest host first');if(room.battle && room.battle.endsAt>Date.now())throw Error('A battle is already running');room.battle={startedAt:Date.now(),endsAt:Date.now()+180_000,hostId:room.hostId,guestId:room.guest.user.id,hostPoints:0,guestPoints:0};return this.battleState(room);}
  battleState(room){const b=room.battle;if(!b)return null;return {...b,active:Boolean(room.guest && Date.now()<b.endsAt),hostName:room.hostName,guestName:room.guest?.user.displayName||room.lastGuestName||'Guest'};}
  scoreGift(room,senderId,recipientId,points){const b=room.battle;if(!b||Date.now()>=b.endsAt||!room.guest||[b.hostId,b.guestId].includes(senderId))return null;if(recipientId===b.hostId)b.hostPoints+=points;else if(recipientId===b.guestId)b.guestPoints+=points;else return null;return this.battleState(room);}
  finishBattle(room){if(!room.battle)return null;const state=this.battleState(room);room.battle=null;return {...state,active:false};}
  kick(socket, userId) {
    const entry = this.peer(socket);
    if (entry?.role !== 'host') throw Error('Only the host can remove viewers');
    const target = [...entry.room.viewers].find(s => s.user.id === userId);
    if (!target) throw Error('Viewer not found');
    if(entry.room.guest===target){entry.room.lastGuestName=target.user.displayName;entry.room.guest=null;}
    if(entry.room.guestInvite?.socket===target)entry.room.guestInvite=null;
    entry.room.blocked.add(userId); this.leave(target); return target;
  }
  leave(socket) {
    const entry = this.peers.get(socket);
    if (!entry) return null;
    this.peers.delete(socket);
    if (entry.role === 'host') {
      this.rooms.delete(entry.room.id);
      for (const viewer of entry.room.viewers) this.peers.delete(viewer);
    } else {entry.room.viewers.delete(socket);if(entry.room.guest===socket){entry.room.lastGuestName=socket.user.displayName;entry.room.guest=null;}if(entry.room.guestInvite?.socket===socket)entry.room.guestInvite=null;}
    return entry;
  }
}
