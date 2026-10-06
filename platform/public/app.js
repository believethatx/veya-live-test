import { Room, RoomEvent, Track, createLocalTracks } from '/livekit.js';
const $ = id => document.getElementById(id);
let socket, liveRoom, localTracks = [], activeRoom, role, currentUser, registering = false, busy = false, pendingRoom;
let config = { mediaConfigured: false, policyVersion: '' };
const status = text => { $('status').textContent = text; };
const notice = text => { $('notice').textContent = text; };
const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
async function api(path, input) {
  const response = await fetch(path, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data;
}
async function refreshRooms() {
  if (activeRoom || !currentUser) return;
  try {
    const { rooms } = await api('/api/rooms'); $('rooms').replaceChildren();
    if (!rooms.length) { $('rooms').className = 'empty'; $('rooms').textContent = 'No one is live yet. Start the first conversation.'; return; }
    $('rooms').className = '';
    for (const room of rooms) {
      const button = document.createElement('button'); button.className = 'room-item';
      const name = document.createElement('strong'); name.textContent = room.title;
      const detail = document.createElement('small'); detail.textContent = `${room.hostName} · ${room.category} · ${room.viewers} viewers`;
      button.append(name, detail); button.onclick = () => requestJoin(room.id); $('rooms').append(button);
    }
  } catch (error) { $('rooms').textContent = error.message; }
}
function requestJoin(id) { if (busy || activeRoom) return; pendingRoom = id; $('viewerRules').checked = false; $('joinDialog').showModal(); }
function updateWatermark() {
  if (!activeRoom) return;
  $('watermark').textContent = `Veya · ${currentUser.displayName} · ${currentUser.id.slice(0, 8)} · ${new Date().toLocaleTimeString()}`;
}
function showRoom(room) {
  $('discover').hidden = true; $('room').hidden = false; $('roomTitle').textContent = room.title;
  $('local').hidden = role !== 'host'; $('remote').hidden = role === 'host'; $('mute').hidden = role !== 'host';
  $('viewersPanel').hidden = role !== 'host'; $('leave').textContent = role === 'host' ? 'End live' : 'Leave';
  $('mute').textContent = 'Mute mic'; $('chatLog').replaceChildren(); $('viewerList').replaceChildren(); $('viewerCount').textContent = '0';
  updateWatermark();
}
async function attachMedia(credentials, roomInfo) {
  const room = new Room({ adaptiveStream: true, dynacast: true }); liveRoom = room;
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (participant.identity !== roomInfo.hostId) return;
    if (track.kind === Track.Kind.Video) track.attach($('remote'));
    if (track.kind === Track.Kind.Audio) { track.attach($('remoteAudio')); $('hearAudio').hidden = room.canPlaybackAudio; }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => { $('hearAudio').hidden = role === 'host' || room.canPlaybackAudio; });
  room.on(RoomEvent.Reconnecting, () => status('Reconnecting to the live…'));
  room.on(RoomEvent.Reconnected, () => status(role === 'host' ? 'You’re live' : 'Watching live'));
  room.on(RoomEvent.Disconnected, () => { if (liveRoom === room && activeRoom) { cleanup(); notice('The live connection ended.'); } });
  await room.connect(credentials.url, credentials.token);
  if (liveRoom !== room || !activeRoom) { await room.disconnect(); throw Error('Room closed'); }
  if (role === 'host') {
    for (const track of localTracks) { await room.localParticipant.publishTrack(track, { source: track.kind === Track.Kind.Video ? Track.Source.Camera : Track.Source.Microphone }); if (track.kind === Track.Kind.Video) track.attach($('local')); }
  } else {
    for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
      if (participant.identity === roomInfo.hostId && publication.track) publication.track.attach(publication.track.kind === Track.Kind.Video ? $('remote') : $('remoteAudio'));
    }
    try { await room.startAudio(); } catch { $('hearAudio').hidden = false; }
  }
  send({ type: 'ready' });
}
function connect(firstMessage) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`); socket = ws;
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; reject(Error('The room took too long to connect.')); cleanup(); } }, 20000);
    const fail = message => { clearTimeout(timeout); if (!settled) { settled = true; reject(Error(message)); } else notice(message); };
    ws.onopen = () => ws.send(JSON.stringify(firstMessage));
    ws.onmessage = async event => {
      if (socket !== ws) return;
      const msg = JSON.parse(event.data);
      if (msg.type === 'error') { fail(msg.message); return; }
      if (msg.type === 'created' || msg.type === 'joined') {
        activeRoom = msg.room.id; history.replaceState(null, '', `?room=${encodeURIComponent(activeRoom)}`); showRoom(msg.room); status('Connecting live video…');
        try { await attachMedia(msg.media, msg.room); } catch (error) { fail(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to host.' : 'Could not connect live video. Try again.'); cleanup(); }
      }
      if (msg.type === 'ready') { clearTimeout(timeout); settled = true; status(role === 'host' ? 'You’re live' : 'Watching live'); resolve(); }
      if (msg.type === 'chat') {
        const item = document.createElement('li'); const name = document.createElement('span'); name.className = 'chat-name'; name.textContent = msg.name;
        item.append(name, document.createTextNode(msg.text)); $('chatLog').append(item);
        if ($('chatLog').children.length > 100) $('chatLog').firstChild.remove(); $('chatLog').scrollTop = $('chatLog').scrollHeight;
      }
      if (msg.type === 'viewers') $('viewerCount').textContent = msg.count;
      if (msg.type === 'roster') {
        $('viewerList').replaceChildren();
        if (!msg.viewers.length) $('viewerList').textContent = 'Waiting for your first viewer.';
        for (const viewer of msg.viewers) {
          const row = document.createElement('div'); row.className = 'viewer'; const name = document.createElement('span'); name.textContent = viewer.name;
          const button = document.createElement('button'); button.className = 'btn danger'; button.textContent = 'Remove'; button.onclick = () => send({ type: 'kick', userId: viewer.id }); row.append(name, button); $('viewerList').append(row);
        }
      }
      if (msg.type === 'reported') { $('reportDialog').close(); notice('Report received. Thank you for helping keep Veya safe.'); }
      if (msg.type === 'ended') { fail(msg.message); cleanup(); notice(msg.message); }
    };
    ws.onerror = () => fail('Could not reach the live room service.');
    ws.onclose = () => { clearTimeout(timeout); if (socket !== ws) return; fail('The room connection ended.'); cleanup(); };
  });
}
function cleanup() {
  activeRoom = null; const room = liveRoom; liveRoom = null; void room?.disconnect();
  for (const track of localTracks) { track.detach(); track.stop(); } localTracks = [];
  const ws = socket; socket = null; ws?.close();
  for (const id of ['local', 'remote', 'remoteAudio']) $(id).srcObject = null;
  $('room').hidden = true; $('discover').hidden = !currentUser; $('hearAudio').hidden = true;
  $('reportDialog').close(); $('joinDialog').close(); $('chatLog').replaceChildren();
  history.replaceState(null, '', location.pathname); refreshRooms();
}
$('start').onclick = async () => {
  if (busy) return; notice('');
  if (!$('hostRules').checked) { notice('Accept the room privacy rules before going live.'); return; }
  if (!config.mediaConfigured) { notice('Live video setup is still pending.'); return; }
  busy = true; $('start').disabled = true; role = 'host';
  try {
    if ($('title').value.trim().length < 3) throw Error('Enter a room title of at least 3 characters.');
    localTracks = await createLocalTracks({ audio: true, video: { facingMode: 'user', resolution: { width: 640, height: 480, frameRate: 24 } } });
    await connect({ type: 'create', title: $('title').value, category: $('category').value, acceptRules: true, policyVersion: config.policyVersion });
  } catch (error) { cleanup(); notice(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to host.' : error.message); }
  finally { busy = false; $('start').disabled = !config.mediaConfigured; }
};
$('cancelJoin').onclick = () => $('joinDialog').close();
$('confirmJoin').onclick = async () => {
  if (!$('viewerRules').checked) { notice('Accept the room privacy rules before joining.'); return; }
  if (busy) return; busy = true; role = 'viewer'; $('joinDialog').close(); notice('');
  try { await connect({ type: 'join', roomId: pendingRoom, acceptRules: true, policyVersion: config.policyVersion }); }
  catch (error) { cleanup(); notice(error.message); } finally { busy = false; }
};
$('share').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(activeRoom)}`;
  try { if (navigator.share) await navigator.share({ title: 'Join me on Veya', url }); else { await navigator.clipboard.writeText(url); notice('Invite link copied.'); } }
  catch (error) { if (error.name !== 'AbortError') notice(url); }
};
$('mute').onclick = async () => { const track = localTracks.find(t => t.kind === Track.Kind.Audio); if (!track) return; await (track.isMuted ? track.unmute() : track.mute()); $('mute').textContent = track.isMuted ? 'Unmute mic' : 'Mute mic'; };
$('hearAudio').onclick = async () => { await liveRoom?.startAudio(); $('hearAudio').hidden = true; };
$('leave').onclick = cleanup;
$('chatForm').onsubmit = event => { event.preventDefault(); send({ type: 'chat', text: $('chatText').value }); $('chatText').value = ''; };
$('openReport').onclick = () => { $('reportDetails').value = ''; $('reportDialog').showModal(); };
$('cancelReport').onclick = () => $('reportDialog').close();
$('reportForm').onsubmit = event => { event.preventDefault(); send({ type: 'report', reason: $('reportReason').value, details: $('reportDetails').value }); };
$('toggleAccount').onclick = () => {
  registering = !registering; $('registerFields').hidden = !registering;
  $('displayName').required = registering; $('adult').required = registering;
  $('formTitle').textContent = registering ? 'Create your account' : 'Sign in'; $('submitAccount').textContent = registering ? 'Create account' : 'Sign in';
  $('toggleAccount').textContent = registering ? 'Sign in instead' : 'Create account'; $('password').autocomplete = registering ? 'new-password' : 'current-password';
};
const linkedRoom = new URLSearchParams(location.search).get('room');
async function showSignedIn(user) {
  currentUser = user; $('account').hidden = true; $('discover').hidden = false; $('who').textContent = user.displayName; $('openAdmin').hidden = !user.admin;
  await refreshRooms(); if (linkedRoom && !activeRoom) requestJoin(linkedRoom);
}
$('accountForm').onsubmit = async event => {
  event.preventDefault(); notice(''); $('submitAccount').disabled = true;
  try {
    const input = { email: $('email').value, password: $('password').value };
    if (registering) { input.displayName = $('displayName').value; input.adult = $('adult').checked; }
    const { user } = await api(registering ? '/api/register' : '/api/login', input); $('password').value = ''; await showSignedIn(user);
  } catch (error) { notice(error.message); } finally { $('submitAccount').disabled = false; }
};
$('logout').onclick = async () => { try { await api('/api/logout', {}); currentUser = null; cleanup(); $('admin').hidden = true; $('account').hidden = false; $('openAdmin').hidden = true; notice('Signed out.'); } catch (error) { notice(error.message); } };
async function loadReports() {
  const { reports } = await api('/api/admin/reports'); $('reports').replaceChildren();
  if (!reports.length) $('reports').textContent = 'No reports yet.';
  for (const report of reports) {
    const item = document.createElement('div'); item.className = 'report-item';
    const heading = document.createElement('h2'); heading.textContent = report.reason;
    const description = document.createElement('p'); description.textContent = `${report.host_name} · ${report.room_title} · ${report.status}`;
    const details = document.createElement('p'); details.textContent = report.details || 'No extra details';
    const actions = document.createElement('div'); actions.className = 'row';
    const end = document.createElement('button'); end.className = 'btn danger'; end.textContent = 'End room';
    end.onclick = async () => { try { await api('/api/admin/end-room', { roomId: report.room_id }); notice('Room ended by moderation.'); } catch (error) { notice(error.message); } };
    const review = document.createElement('button'); review.className = 'btn secondary'; review.textContent = 'Mark reviewed'; review.disabled = report.status === 'reviewed';
    review.onclick = async () => { try { await api('/api/admin/review-report', { reportId: report.id }); await loadReports(); } catch (error) { notice(error.message); } };
    actions.append(end, review); item.append(heading, description, details, actions); $('reports').append(item);
  }
}
$('openAdmin').onclick = async () => { if (activeRoom || busy) { notice('Leave your room before opening moderation.'); return; } try { await loadReports(); $('discover').hidden = true; $('admin').hidden = false; } catch (error) { notice(error.message); } };
$('closeAdmin').onclick = () => { $('admin').hidden = true; $('discover').hidden = false; refreshRooms(); };
$('videoStage').oncontextmenu = event => event.preventDefault();
window.addEventListener('pagehide', cleanup);
try { config = await api('/api/config'); $('start').disabled = !config.mediaConfigured; $('setupState').textContent = config.mediaConfigured ? 'Your camera and microphone are checked before the room goes live.' : 'Live video is not connected yet. Hosting setup is pending.'; const { user } = await api('/api/me'); if (user) await showSignedIn(user); }
catch { notice('Could not reach Veya. Try again shortly.'); }
setInterval(() => { if (currentUser && !$('discover').hidden) refreshRooms(); }, 10000);
setInterval(updateWatermark, 1000);
