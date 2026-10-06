import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RoomRegistry } from '../rooms.mjs';

test('a disconnected host removes the room and both peer memberships', () => {
  const rooms = new RoomRegistry(); const host = {}; const viewer = {};
  const room = rooms.create(host, 'A real room', 'Chat'); rooms.join(viewer, room.id);
  assert.equal(rooms.list()[0].viewers, 1);
  rooms.leave(host);
  assert.equal(rooms.list().length, 0);
  assert.equal(rooms.peer(viewer), undefined);
  assert.throws(() => rooms.join({}, room.id), /ended/);
});
test('a room has one viewer slot and frees it after a viewer leaves', () => {
  const rooms = new RoomRegistry(); const room = rooms.create({}, 'A real room', 'Music'); const first = {};
  rooms.join(first, room.id);
  assert.throws(() => rooms.join({}, room.id), /full/);
  rooms.leave(first);
  assert.equal(rooms.list()[0].viewers, 0);
  rooms.join({}, room.id);
  assert.equal(rooms.list()[0].viewers, 1);
});
