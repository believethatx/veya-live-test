import { setTimeout as delay } from 'node:timers/promises';
import { AccessToken, RoomServiceClient, WebhookReceiver, TrackSource } from 'livekit-server-sdk';
export function createMedia(env = process.env) {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = env;
  const configured = Boolean(url && key && secret);
  const client = configured ? new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret) : null;
  const receiver = configured ? new WebhookReceiver(key, secret) : null;
  return {
    configured,
    async token(user, room, role) {
      if (!configured) throw Error('Live video is not connected yet');
      const token = new AccessToken(key, secret, { identity: user.id, name: user.displayName, ttl: 60 });
      token.addGrant({ roomJoin: true, room: room.id, canSubscribe: true,
        canPublish: role === 'host', canPublishData: false,
        canPublishSources: role === 'host' ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
        canUpdateOwnMetadata: false, roomRecord: false, roomAdmin: false });
      return { url, token: await token.toJwt() };
    },
    async verify(room, user, role) {
      // Track-publish acknowledgement can precede the server receiving camera packets.
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const participant = await client.getParticipant(room.id, user.id);
          if (role !== 'host' || participant.tracks.some(t => t.source === TrackSource.CAMERA && !t.muted)) return;
        } catch { /* Wait briefly for the newly joined participant to register. */ }
        await delay(250);
      }
      throw Error(role === 'host' ? 'Your camera did not become live. Try again.' : 'Your live connection did not become ready. Try again.');
    },
    async end(room) { if (configured) await client.deleteRoom(room.id); },
    async remove(room, userId) { if (configured) await client.removeParticipant(room.id, userId); },
    async webhook(body, authorization) {
      if (!receiver) throw Error('Media is not configured');
      return receiver.receive(body, authorization);
    },
  };
}
