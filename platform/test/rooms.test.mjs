import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RoomRegistry } from '../rooms.mjs';
const socket = name => ({ user: { id: name, displayName: name } });
test('only a media-ready host is listed, and counts are media-ready viewers', () => {
  const rooms = new RoomRegistry(), host = socket('host'), a = socket('a'), b = socket('b');
  const room = rooms.create(host, 'A real room', 'Chat');
  assert.deepEqual(rooms.list(), []); assert.throws(() => rooms.join(a, room.id), /not live/);
  rooms.ready(host); rooms.join(a, room.id); rooms.join(b, room.id);
  assert.equal(rooms.list()[0].viewers, 0); rooms.ready(a); rooms.ready(b);
  assert.equal(rooms.list()[0].viewers, 2); rooms.leave(a); assert.equal(rooms.list()[0].viewers, 1);
  rooms.leave(host); assert.deepEqual(rooms.list(), []); assert.equal(rooms.peer(b), undefined);
});
test('host removal blocks rejoining, and viewers cannot remove another viewer', () => {
  const rooms = new RoomRegistry(), host = socket('host'), a = socket('a'), b = socket('b');
  const room = rooms.create(host, 'A real room', 'Music'); rooms.ready(host); rooms.join(a, room.id); rooms.join(b, room.id);
  assert.throws(() => rooms.kick(a, 'b'), /Only the host/);
  assert.equal(rooms.kick(host, 'a'), a); assert.equal(rooms.peer(a), undefined);
  assert.throws(() => rooms.join(socket('a'), room.id), /removed/);
  assert.throws(() => rooms.join(socket('b'), room.id), /another tab/);
});
