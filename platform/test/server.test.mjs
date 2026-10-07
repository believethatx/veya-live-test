import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
const directory = mkdtempSync(join(tmpdir(), 'veya-server-')); process.env.DATA_FILE = join(directory, 'test.sqlite');
const { createApp } = await import('../server.mjs');
const {manage}=await import('../access.mjs');
const { POLICY_VERSION } = await import('../safety.mjs');
const next = (socket, type) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off('message', listener); reject(Error(`Missing ${type}`)); }, 5000);
  const listener = raw => { const value = JSON.parse(raw); if (value.type === type) { clearTimeout(timer); socket.off('message', listener); resolve(value); } }; socket.on('message', listener);
});
const exchange = (socket, input, type) => { const output = next(socket, type); socket.send(JSON.stringify(input)); return output; };
test('real HTTP/WS clients: consent, multiple viewers, reporting, moderation, logout and cleanup', async t => {
  let cameraAvailable = false;
  const removed = [], ended = [], media = { configured: true, token: async () => ({ token: 'fake-only-in-test', url: 'ws://localhost:7880' }), verify: async (room, user, role) => { if (role === 'host' && !cameraAvailable) throw Error('Your camera is not live yet'); }, remove: async (room, id) => removed.push(id), end: async room => ended.push(room.id), webhook: async () => { throw Error('invalid'); } };
  const { server } = createApp({ media }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = []; t.after(async () => { for (const socket of sockets) socket.terminate(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  async function request(path, cookie, input, origin = base) {
    return fetch(`${base}${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { Cookie: cookie || '', Origin: origin, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  }
  async function account(name) {
    const response = await request('/api/register', '', { email: `${name}@example.test`, displayName: name, password: 'a long unique password', adult: true });
    assert.equal(response.status, 200); const cookie=response.headers.get('set-cookie').split(';')[0];const user=(await response.json()).user;await request('/api/profile',cookie,{displayName:name,country:'GB',bio:'',avatar:'',interests:[],adult:true});return {cookie,user};
  }
  async function connect(account) {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/signal`, { headers: { Origin: base, Cookie: account.cookie } }); sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); return socket;
  }
  assert.equal((await request('/api/rooms')).status, 401);
  const owner = await account('Owner'), a = await account('ViewerA'), b = await account('ViewerB');
  assert.equal((await request('/api/admin/reports', a.cookie)).status, 403);
  process.env.ADMIN_USER_IDS = owner.user.id;manage(owner.user,{action:'tester',userId:a.user.id,approved:true});manage(owner.user,{action:'tester',userId:b.user.id,approved:true});
  const host = await connect(owner);
  assert.match((await exchange(host, { type: 'create', title: 'A real live room' }, 'error')).message, /Accept/);
  const consent = { acceptRules: true, policyVersion: POLICY_VERSION };
  assert.match((await exchange(host, { type: 'create', title: '  ', ...consent }, 'error')).message, /room title/);
  const { room } = await exchange(host, { type: 'create', title: 'A real live room', ...consent }, 'created');
  assert.equal((await (await request('/api/rooms', a.cookie)).json()).rooms.length, 0);
  assert.match((await exchange(host, { type: 'ready' }, 'error')).message, /camera is not live/);
  assert.equal((await (await request('/api/rooms', a.cookie)).json()).rooms.length, 0);
  cameraAvailable = true; await exchange(host, { type: 'ready' }, 'ready');
  const viewerA = await connect(a), viewerB = await connect(b);
  await exchange(viewerA, { type: 'join', roomId: room.id, ...consent }, 'joined'); await exchange(viewerA, { type: 'ready' }, 'ready');
  await exchange(viewerB, { type: 'join', roomId: room.id, ...consent }, 'joined'); await exchange(viewerB, { type: 'ready' }, 'ready');
  assert.equal((await (await request('/api/gifts/wallet',a.cookie)).json()).wallet.balance,250);
  assert.equal((await request('/api/gifts/wallet')).status,401);
  assert.equal((await request('/api/admin/test-gifts',a.cookie)).status,403);
  const giftEvent=next(host,'gift'),giftId='a'.repeat(32);
  const giftAck=await exchange(viewerA,{type:'gift',recipientId:owner.user.id,giftId:'heart',requestId:giftId},'gift-sent');
  assert.equal(giftAck.balance,245);assert.equal((await giftEvent).recipientId,owner.user.id);
  assert.equal((await (await request('/api/gifts/wallet',owner.cookie)).json()).wallet.receivedPoints,5);
  assert.equal((await (await request('/api/admin/test-gifts',owner.cookie)).json()).transfers.length,1);
  const retry=await exchange(viewerA,{type:'gift',recipientId:owner.user.id,giftId:'heart',requestId:giftId},'gift-sent');assert.equal(retry.balance,245);
  assert.equal((await (await request('/api/admin/test-gifts',owner.cookie)).json()).transfers.length,1);
  assert.match((await exchange(viewerA,{type:'gift',recipientId:a.user.id,giftId:'heart',requestId:'b'.repeat(32)},'gift-error')).message,/someone else/);
  assert.equal((await (await request('/api/rooms', a.cookie)).json()).rooms[0].viewers, 2);assert.equal('category' in (await (await request('/api/rooms', a.cookie)).json()).rooms[0], false);
  const chat = next(viewerB, 'chat'); await exchange(viewerA, { type: 'chat', text: '<script>not executable</script>' }, 'chat'); assert.equal((await chat).text, '<script>not executable</script>');
  const report = await exchange(viewerB, { type: 'report', reason: 'Recording or screenshots', details: 'A viewer was recording.' }, 'reported');
  const reports = await (await request('/api/admin/reports', owner.cookie)).json(); assert.equal(reports.reports[0].id, report.id);
  assert.equal((await request('/api/admin/end-room', a.cookie, { roomId: room.id })).status, 403);
  assert.equal((await request('/api/admin/end-room', owner.cookie, { roomId: room.id }, 'https://attacker.example')).status, 403);
  assert.match((await exchange(viewerB, { type: 'kick', userId: a.user.id }, 'error')).message, /Only the host/);
  const kicked = next(viewerA, 'ended'); host.send(JSON.stringify({ type: 'kick', userId: a.user.id })); await kicked;
  const returning = await connect(a); assert.match((await exchange(returning, { type: 'join', roomId: room.id, ...consent }, 'error')).message, /removed/); returning.close();
  assert.ok(removed.includes(a.user.id));
  const final = next(viewerB, 'ended'); const response = await request('/api/admin/end-room', owner.cookie, { roomId: room.id }); assert.equal(response.status, 200); await final;
  assert.equal((await (await request('/api/rooms', b.cookie)).json()).rooms.length, 0); assert.ok(ended.includes(room.id));
  assert.equal((await request('/api/admin/review-report', owner.cookie, { reportId: report.id })).status, 200);
  assert.equal((await (await request('/api/admin/reports', owner.cookie)).json()).reports[0].status, 'reviewed');
  const loggedOut = await connect(b); const closed = new Promise(resolve => loggedOut.once('close', resolve));
  assert.equal((await request('/api/logout', b.cookie, {})).status, 200); await closed;
  assert.equal((await request('/api/rooms', b.cookie)).status, 401);
  assert.equal((await request('/api/livekit/webhook', '', {})).status, 401);
});
