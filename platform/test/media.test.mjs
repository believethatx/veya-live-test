import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TokenVerifier } from 'livekit-server-sdk';
import { createMedia } from '../media.mjs';
const key = 'devkey', secret = 'secret-long-enough-for-local-tests';
const media = createMedia({ LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret });
const user = { id: 'account-id', displayName: 'Account' }, room = { id: 'room-id' };
test('host tokens allow camera/mic but never screen share, recording or admin', async () => {
  const { token } = await media.token(user, room, 'host');
  const claims = await new TokenVerifier(key, secret).verify(token);
  assert.equal(claims.sub, user.id); assert.equal(claims.video.room, room.id);
  assert.equal(claims.video.canPublish, true);
  assert.deepEqual(claims.video.canPublishSources, ['camera', 'microphone']);
  assert.equal(claims.video.roomRecord, false); assert.equal(claims.video.roomAdmin, false);
  assert.equal(claims.video.canPublishData, false); assert.ok(claims.exp - claims.nbf <= 60);
});
test('viewers cannot publish any track or use recording/admin grants', async () => {
  const { token } = await media.token(user, room, 'viewer');
  const claims = await new TokenVerifier(key, secret).verify(token);
  assert.equal(claims.video.canPublish, false); assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.roomRecord, false); assert.equal(claims.video.roomAdmin, false);
});
test('an unconfigured media service fails explicitly instead of simulating live', async () => {
  const empty = createMedia({}); assert.equal(empty.configured, false);
  await assert.rejects(empty.token(user, room, 'host'), /not connected/);
});
