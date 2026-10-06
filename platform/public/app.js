const $ = id => document.getElementById(id);
let socket, connection, localStream, activeRoom, role;
let pendingCandidates = [];
const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
const status = text => { $('status').textContent = text; };
const notice = text => { $('notice').textContent = text; };
const showRoom = (title, asHost) => {
  $('discover').hidden = true; $('room').hidden = false; $('roomTitle').textContent = title;
  $('local').hidden = !asHost; $('remote').hidden = asHost;
  $('invite').hidden = !asHost; $('mute').hidden = !asHost;
};
async function refreshRooms() {
  if (activeRoom) return;
  try {
    const response = await fetch('/api/rooms', { cache: 'no-store' });
    if (!response.ok) throw Error('Rooms unavailable');
    const { rooms } = await response.json();
    $('rooms').replaceChildren();
    if (!rooms.length) { $('rooms').textContent = 'No one is live right now.'; return; }
    for (const room of rooms) {
      const button = document.createElement('button'); button.className = 'room-item';
      const name = document.createElement('strong'); name.textContent = room.title;
      const detail = document.createElement('small'); detail.textContent = `${room.category} · ${room.viewers} viewer${room.viewers === 1 ? '' : 's'}`;
      button.append(name, detail); button.onclick = () => join(room.id);
      $('rooms').append(button);
    }
  } catch { $('rooms').textContent = 'Could not load rooms. Try again shortly.'; }
}
function makeConnection() {
  connection?.close();
  pendingCandidates = [];
  connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  connection.onicecandidate = event => { if (event.candidate) send({ type: 'signal', data: { type: 'candidate', candidate: event.candidate } }); };
  connection.ontrack = event => { $('remote').srcObject = event.streams[0]; status('Connected to the host'); };
  connection.onconnectionstatechange = () => {
    if (connection?.connectionState === 'failed' || connection?.connectionState === 'disconnected') status('Connection interrupted. Rejoin if it does not recover.');
    if (connection?.connectionState === 'connected') status(role === 'host' ? 'Viewer connected' : 'Connected to the host');
  };
  if (role === 'host') localStream.getTracks().forEach(track => connection.addTrack(track, localStream));
  else { connection.addTransceiver('video', { direction: 'recvonly' }); connection.addTransceiver('audio', { direction: 'recvonly' }); }
}
async function signal(data) {
  if (!connection) makeConnection();
  if (data.type === 'offer') {
    await connection.setRemoteDescription(data.description);
    for (const candidate of pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
    const answer = await connection.createAnswer(); await connection.setLocalDescription(answer);
    send({ type: 'signal', data: { type: 'answer', description: connection.localDescription } });
  } else if (data.type === 'answer') {
    await connection.setRemoteDescription(data.description);
    for (const candidate of pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
  } else if (data.type === 'candidate') {
    if (connection.remoteDescription) await connection.addIceCandidate(data.candidate);
    else pendingCandidates.push(data.candidate);
  }
}
function connect(firstMessage) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`);
    socket.onopen = () => send(firstMessage);
    socket.onmessage = async event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'error') { notice(msg.message); if (!activeRoom) reject(Error(msg.message)); return; }
      if (msg.type === 'created' || msg.type === 'joined') {
        activeRoom = msg.room.id; history.replaceState(null, '', msg.type === 'joined' ? `?room=${encodeURIComponent(activeRoom)}` : location.pathname);
        showRoom(msg.room.title, role === 'host'); status(role === 'host' ? 'Waiting for a viewer' : 'Connecting to the host…'); resolve();
      }
      if (msg.type === 'peer-joined') {
        makeConnection(); const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
        send({ type: 'signal', data: { type: 'offer', description: connection.localDescription } });
      }
      if (msg.type === 'signal') { try { await signal(msg.data); } catch { status('Video connection failed. Leave and rejoin.'); } }
      if (msg.type === 'chat') {
        const item = document.createElement('li'); item.textContent = `${msg.role === 'host' ? 'Host' : 'Viewer'}: ${msg.text}`;
        $('chatLog').append(item); $('chatLog').scrollTop = $('chatLog').scrollHeight;
      }
      if (msg.type === 'peer-left') { connection?.close(); connection = null; status('Viewer left. Waiting for another viewer.'); }
      if (msg.type === 'ended') { cleanup(); notice('The host ended this room.'); }
    };
    socket.onerror = () => { notice('Could not reach the room service.'); if (!activeRoom) reject(Error('Connection failed')); };
    socket.onclose = () => { if (activeRoom) { cleanup(); notice('Connection ended.'); } };
  });
}
function cleanup() {
  activeRoom = null; connection?.close(); connection = null;
  localStream?.getTracks().forEach(track => track.stop()); localStream = null;
  if (socket?.readyState === WebSocket.OPEN) socket.close(); socket = null;
  $('local').srcObject = null; $('remote').srcObject = null; $('room').hidden = true; $('discover').hidden = false;
  history.replaceState(null, '', location.pathname); refreshRooms();
}
async function join(id) {
  notice(''); role = 'viewer';
  try { await connect({ type: 'join', roomId: id }); } catch { cleanup(); }
}
$('start').onclick = async () => {
  notice(''); $('start').disabled = true;
  try {
    if ($('title').value.trim().length < 3) throw Error('Enter a room title of at least 3 characters.');
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    $('local').srcObject = localStream; role = 'host';
    await connect({ type: 'create', title: $('title').value, category: $('category').value });
  } catch (error) { localStream?.getTracks().forEach(track => track.stop()); localStream = null; notice(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to host.' : error.message); }
  finally { $('start').disabled = false; }
};
$('share').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(activeRoom)}`;
  try { await navigator.clipboard.writeText(url); status('Invite link copied'); }
  catch { status(url); }
};
$('mute').onclick = () => {
  const tracks = localStream?.getAudioTracks() ?? []; if (!tracks.length) return;
  tracks.forEach(t => t.enabled = !t.enabled); $('mute').textContent = tracks[0].enabled ? 'Mute mic' : 'Unmute mic';
};
$('leave').onclick = cleanup;
$('chatForm').onsubmit = event => { event.preventDefault(); send({ type: 'chat', text: $('chatText').value }); $('chatText').value = ''; };
const linkedRoom = new URLSearchParams(location.search).get('room');
if (linkedRoom) join(linkedRoom); else refreshRooms();
setInterval(refreshRooms, 10000);
