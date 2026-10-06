import { Room, RoomEvent, Track, createLocalTracks } from '/livekit.js';
const $ = id => document.getElementById(id);
let socket, liveRoom, localTracks = [], activeRoom, role, currentUser, registering = false, busy = false, pendingRoom;
let managementData, previewTracks=[], previewGeneration=0, notificationItems=[];
function textElement(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
let config = { mediaConfigured: false, policyVersion: '' };
const status = text => { $('status').textContent = text; };
const notice = text => { $('notice').textContent = text; };
const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
async function api(path, input) {
  const response = await fetch(path, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data;
}
const interests = ['Chat', 'Music', 'Gaming', 'Other'];
let allRooms = [], selectedCategory = 'All', draftAvatar = '', editingProfile = false;
function paintAvatar(element, name, avatar = '') {
  element.replaceChildren();
  if (avatar) {const img = document.createElement('img');img.src = avatar;img.alt = '';element.append(img);}
  else element.textContent = (name || 'V').trim().slice(0,1).toUpperCase();
}
function navigate(destination, force = false) {
  if(currentUser && !force && !currentUser.access?.accessAllowed && !currentUser.admin && destination!=='onboarding')destination='profile';
  if(destination==='studio' && !currentUser.access?.canHost){destination='profile';}
  if (!force && (busy || activeRoom)) {notice('Leave your live room first.');return;}
  for (const id of ['discover','profile','studio','onboarding','admin','following','updates','hostHub']) $(id).hidden = id !== destination;
  $('appNav').hidden = destination === 'onboarding';
  for (const [id,target] of [['navHome','discover'],['navProfile','profile'],['navLive','studio'],['navFollowing','following'],['navUpdates','updates'],['navHost','hostHub']]) {
    if (target === destination) $(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');
  }
  if(destination === 'discover') void refreshRooms();
  if(destination === 'profile') {renderProfile();void loadOwnAccess();}
  if(destination==='following')void loadPeople(true);
  if(destination==='updates')void loadUpdates(true);
  if(destination==='hostHub')void loadHostHub();
  if(destination!=='studio')stopPreview();
  notice('');window.scrollTo(0,0);
}
function renderRooms() {
  const query = $('roomSearch').value.trim().toLowerCase();
  const matches = allRooms.filter(r => (selectedCategory === 'All' || r.category === selectedCategory) && `${r.title} ${r.hostName}`.toLowerCase().includes(query));
  $('roomCount').textContent = `${matches.length} live ${matches.length === 1 ? 'room' : 'rooms'}`;
  $('rooms').replaceChildren();$('rooms').className = 'rooms-grid';
  if (!matches.length) {
    const empty = document.createElement('div');empty.className='empty';
    const icon=document.createElement('div');icon.className='empty-icon';icon.textContent='✦';icon.setAttribute('aria-hidden','true');
    const title=document.createElement('h2');title.textContent=allRooms.length ? 'No lives match just yet.' : 'No hosts are live right now.';
    const text=document.createElement('p');text.textContent=allRooms.length ? 'Try another category or search for a different host.' : 'Follow a host below and see their next live in your updates.';
    const button=document.createElement('button');button.className='btn';button.textContent=allRooms.length ? 'Clear filters' : 'Browse hosts';button.onclick=()=>{if(allRooms.length){selectedCategory='All';$('roomSearch').value='';updateFilters();renderRooms();}else $('hostDirectory').scrollIntoView({behavior:'smooth'});};
    empty.append(icon,title,text,button);$('rooms').append(empty);return;
  }
  for (const room of matches) {
    const button=document.createElement('button');button.className='room-item';
    const cover=document.createElement('div');cover.className='room-cover';
    const badge=document.createElement('span');badge.className='live-label';badge.textContent='LIVE';
    const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,room.hostName,room.hostAvatar);cover.append(badge,avatar);
    const copy=document.createElement('div');copy.className='room-copy';const name=document.createElement('strong');name.textContent=room.title;
    const detail=document.createElement('small');detail.textContent=`${room.hostName} · ${room.category} · ${room.viewers} viewers`;
    copy.append(name,detail);button.append(cover,copy);button.onclick=()=>requestJoin(room.id);$('rooms').append(button);
  }
}
function updateFilters() {for(const button of $('categoryFilters').children)button.setAttribute('aria-pressed',String(button.dataset.category===selectedCategory));}
for(const category of ['All',...interests]) {const button=document.createElement('button');button.className='filter-chip';button.dataset.category=category;button.textContent=category;button.onclick=()=>{selectedCategory=category;updateFilters();renderRooms();};$('categoryFilters').append(button);}updateFilters();
$('roomSearch').oninput=renderRooms;
async function refreshRooms() {
  if (activeRoom || !currentUser || $('discover').hidden) return;
  try {const {rooms}=await api('/api/rooms');allRooms=rooms;renderRooms();void loadPeople(false);}
  catch(error){$('rooms').textContent=error.message;}
}
function renderProfile() {
  $('accountId').textContent=currentUser.id;renderAccess();
  paintAvatar($('profileAvatar'),currentUser.displayName,currentUser.avatar);
  paintProfileDetails('profile',currentUser);
  $('profileFollowers').textContent='—';$('profileFollowing').textContent='—';void loadProfileStats();
  $('viewOwnPublicProfile').hidden=!currentUser.access?.accessAllowed;
  $('profileCountryLabel').textContent='Country or region: '+(config.countries?.find(c=>c.code===currentUser.country)?.name || currentUser.country);
  $('profileDisplayName').textContent=currentUser.displayName;$('profileAbout').textContent=currentUser.bio || '';
}
function setProfileStep() {
  $('cancelProfile').hidden=!editingProfile;
  $('onboardingProgress').textContent=editingProfile ? 'Your profile' : 'Make yourself at home';
  $('onboardingTitle').textContent=editingProfile ? 'Make it yours.' : 'A little about you.';
  $('onboardingSubtitle').textContent='Choose your name and country. Photo and bio are optional.';
  $('profileNext').textContent=editingProfile ? 'Save profile' : 'Enter Veya';$('profileError').textContent='';
}
function openProfileSetup(editing=false) {
  $('optionalProfileDetails').hidden=!editing;$('profileAge').value=currentUser.age ?? '';renderHobbyPicker(currentUser.hobbies || []);
  editingProfile=editing;$('profileCountry').value=currentUser.country || '';draftAvatar=currentUser.avatar || '';$('profileName').value=currentUser.displayName;$('profileBio').value=currentUser.bio || '';
  $('onboardingAdult').checked=currentUser.adult;$('onboardingAdultLabel').hidden=currentUser.adult;paintAvatar($('avatarPreview'),currentUser.displayName,draftAvatar);
  setProfileStep(1);navigate('onboarding');
}
$('profileName').oninput=()=>paintAvatar($('avatarPreview'),$('profileName').value,draftAvatar);
$('avatarFile').onchange=async()=>{
  const file=$('avatarFile').files[0];if(!file)return;let image;
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP photo under 5 MB.');
    image=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#171c2a';ctx.fillRect(0,0,256,256);
    const size=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,256,256);
    draftAvatar=canvas.toDataURL('image/jpeg',.82);paintAvatar($('avatarPreview'),$('profileName').value,draftAvatar);$('profileError').textContent='';
  }catch(e){$('profileError').textContent=e.message || 'Could not read that photo.';}finally{image?.close();$('avatarFile').value='';}
};
$('removeAvatar').onclick=()=>{draftAvatar='';paintAvatar($('avatarPreview'),$('profileName').value);};
$('cancelProfile').onclick=()=>navigate('profile');
$('profileForm').onsubmit=async event=>{
  event.preventDefault();$('profileError').textContent='';
  if(!currentUser.adult && !$('onboardingAdult').checked){$('profileError').textContent='Confirm you are 18 or older to continue.';return;}
  $('profileNext').disabled=true;
  try{const {user}=await api('/api/profile',{displayName:$('profileName').value,country:$('profileCountry').value,bio:$('profileBio').value,age:$('profileAge').value===''?null:Number($('profileAge').value),hobbies:[...$('profileHobbies').querySelectorAll('input:checked')].map(x=>x.value),avatar:draftAvatar,interests:[],adult:$('onboardingAdult').checked});const wasEditing=editingProfile;await showSignedIn(user);if(wasEditing)navigate('profile');}
  catch(e){$('profileError').textContent=e.message;}finally{$('profileNext').disabled=false;}
};
$('navHome').onclick=()=>navigate('discover');$('navProfile').onclick=()=>navigate('profile');$('navLive').onclick=()=>navigate('studio');$('emptyGoLive').onclick=()=>navigate('studio');$('backFromStudio').onclick=()=>navigate('discover');$('editProfile').onclick=()=>openProfileSetup(true);
function requestJoin(id) { if (busy || activeRoom) return;if(!currentUser.access?.accessAllowed){navigate('profile');notice('Tester access is waiting for admin approval.');return;} if(!currentUser.adult || (config.accounts?.email && !currentUser.emailVerified)){navigate('profile');notice('Verify your email before joining a live.');return;} pendingRoom = id; $('viewerRules').checked = false; $('joinDialog').showModal(); }
function updateWatermark() {
  if (!activeRoom) return;
  $('watermark').textContent = `Veya · ${currentUser.displayName} · ${currentUser.id.slice(0, 8)} · ${new Date().toLocaleTimeString()}`;
}
function showRoom(room) {
  for(const id of ['discover','profile','studio','onboarding','following','updates','hostHub'])$(id).hidden=true;$('appNav').hidden=true; $('room').hidden = false; $('roomTitle').textContent = room.title;
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
        const message = document.createElement('span'); message.className = 'chat-message'; message.textContent = msg.text;
        item.append(name, message); $('chatLog').append(item);
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
  stopPreview();activeRoom = null; const room = liveRoom; liveRoom = null; void room?.disconnect();
  for (const track of localTracks) { track.detach(); track.stop(); } localTracks = [];
  const ws = socket; socket = null; ws?.close();
  for (const id of ['local', 'remote', 'remoteAudio']) $(id).srcObject = null;
  $('room').hidden = true; for(const id of ['discover','profile','studio','onboarding','following','updates','hostHub'])$(id).hidden=true;$('appNav').hidden=!currentUser;if(currentUser){if(currentUser.onboarded)navigate(currentUser.access?.accessAllowed?'discover':'profile',true);else openProfileSetup();} $('hearAudio').hidden = true;
  $('reportDialog').close(); $('joinDialog').close(); $('chatLog').replaceChildren();
  history.replaceState(null, '', location.pathname); refreshRooms();
}
$('start').onclick = async () => {
  if (busy) return; notice('');
  if (!$('hostRules').checked) { notice('Accept the room privacy rules before going live.'); return; }
  if (!config.mediaConfigured) { notice('Live video setup is still pending.'); return; }
  if(!currentUser.access?.accessAllowed || !currentUser.access?.canHost){navigate('profile');notice('Streaming requires host approval.');return;}
  busy = true; $('start').disabled = true; role = 'host';
  try {
    if ($('title').value.trim().length < 3) throw Error('Enter a room title of at least 3 characters.');
    stopPreview();localTracks = await createLocalTracks(deviceOptions());
    await connect({ type: 'create', title: $('title').value, category: $('category').value, acceptRules: true, policyVersion: config.policyVersion });
  } catch (error) { cleanup(); notice(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to host.' : error.message); }
  finally { busy = false; updateAccount(currentUser); }
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
let linkedRoom = new URLSearchParams(location.search).get('room');
async function showSignedIn(user) {
  currentUser=user;updateAccount(user);$('account').hidden=true;$('who').textContent=user.displayName;$('openAdmin').hidden=!user.admin;
  if(!user.onboarded){openProfileSetup();return;}
  navigate(user.access?.accessAllowed ? 'discover' : 'profile');await refreshRooms();
  if(linkedRoom && user.access?.accessAllowed && !activeRoom && user.adult && (!config.accounts?.email || user.emailVerified)){const invitation=linkedRoom;linkedRoom=null;requestJoin(invitation);}
}
$('accountForm').onsubmit = async event => {
  event.preventDefault(); notice(''); $('submitAccount').disabled = true;
  try {
    const input = { email: $('email').value, password: $('password').value };
    if (registering) { input.displayName = $('displayName').value; input.adult = $('adult').checked; }
    const { user } = await api(registering ? '/api/register' : '/api/login', input); $('password').value = ''; await showSignedIn(user);
  } catch (error) { notice(error.message); } finally { $('submitAccount').disabled = false; }
};
$('logout').onclick = async () => { try { await api('/api/logout', {}); currentUser = null; cleanup(); $('admin').hidden = true; $('account').hidden = false; $('appNav').hidden=true; $('openAdmin').hidden = true; notice('Signed out.'); } catch (error) { notice(error.message); } };
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
$('openAdmin').onclick = async () => { if (activeRoom || busy) { notice('Leave your room before opening moderation.'); return; } try { await loadManagement(); navigate('admin'); } catch (error) { notice(error.message); } };
$('closeAdmin').onclick = () => navigate('discover');
$('videoStage').oncontextmenu = event => event.preventDefault();
window.addEventListener('pagehide', cleanup);
setInterval(() => { if (currentUser && !$('discover').hidden) refreshRooms(); }, 10000);
setInterval(updateWatermark, 1000);

const accountLink = new URLSearchParams(location.hash.slice(1));
const linkToken = accountLink.get('token');
function updateAccount(user) {
  $('emailStatus').textContent = user.emailVerified ? 'Email verified' : config.accounts?.email ? 'Verify your email before joining or hosting lives.' : 'Email delivery setup is pending.';
  $('sendVerification').hidden = Boolean(user.emailVerified || !config.accounts?.email);
  $('adultConfirm').hidden = Boolean(user.adult); $('confirmAdult').hidden = Boolean(user.adult);
  $('emptyGoLive').textContent=user.access?.canHost ? 'Start a live' : 'Become a host';
  $('navLive').textContent=user.access?.canHost ? '+ Go live' : 'Become a host';
  $('start').disabled = !user.access?.canHost || !user.access?.accessAllowed || !config.mediaConfigured || !user.adult || Boolean(config.accounts?.email && !user.emailVerified);
  if (config.accounts?.email && !user.emailVerified) $('emailStatus').closest('details').open = true;
}
for (const button of document.querySelectorAll('[data-provider]')) button.onclick = () => { location.href = `/auth/${button.dataset.provider}`; };
$('sendVerification').onclick = async () => { $('sendVerification').disabled = true; try { const result = await api('/api/account/send-verification',{}); notice(result.message); } catch (e) { notice(e.message); } finally { $('sendVerification').disabled = false; } };
$('confirmAdult').onclick = async () => { try { const {user} = await api('/api/account/adult',{adult:$('socialAdult').checked}); await showSignedIn(user); $('start').disabled = !config.mediaConfigured || (config.accounts?.email && !user.emailVerified); } catch(e) {notice(e.message);} };
$('forgotPassword').onclick = async () => { if (!$('email').value) {notice('Enter your email address first.');$('email').focus();return;} $('forgotPassword').disabled=true; try {const result=await api('/api/account/forgot-password',{email:$('email').value});notice(result.message);}catch(e){notice(e.message);}finally{$('forgotPassword').disabled=false;} };
$('recoveryForm').onsubmit = async event => {event.preventDefault();const button=$('recoveryForm').querySelector('button');button.disabled=true;try{await api('/api/account/reset-password',{token:linkToken,password:$('newPassword').value});location.replace('/#passwordReset=1');location.reload();}catch(e){notice(e.message);}finally{button.disabled=false;} };

try {
  config = await api('/api/config');
  for(const country of config.countries || []){const option=document.createElement('option');option.value=country.code;option.textContent=country.name;$('profileCountry').append(option);}
  for (const button of document.querySelectorAll('[data-provider]')) button.hidden = !config.accounts?.[button.dataset.provider];
  $('socialSignIn').hidden = !config.accounts?.google && !config.accounts?.facebook;
  $('forgotPassword').hidden = !config.accounts?.email;
  $('accountStatus').textContent = config.accounts?.email ? 'New accounts must verify their email before joining live rooms.' : 'Private development build. Email delivery setup is pending.';
  $('start').disabled = !config.mediaConfigured;
  $('setupState').textContent = config.mediaConfigured ? 'Your camera and microphone are checked before the room goes live.' : 'Live video is not connected yet. Hosting setup is pending.';
  if (accountLink.get('action') === 'verify' && linkToken) {
    history.replaceState(null,'','/'); await api('/api/account/verify',{token:linkToken}); notice('Email verified. You can sign in now.');
  } else if (accountLink.get('action') === 'reset' && linkToken) {
    history.replaceState(null,'','/'); $('account').hidden=true; $('recovery').hidden=false;
  } else if (accountLink.has('authError')) {history.replaceState(null,'','/');notice('Social sign-in did not complete. Try again, or sign in with email and connect the provider in Account settings.');}
  else if (accountLink.has('passwordReset')) {history.replaceState(null,'','/');notice('Password updated. Sign in with your new password.');}
  if (!$('recovery').hidden) {} else { const {user}=await api('/api/me'); if(user) await showSignedIn(user); }
} catch(e) {notice(e.message || 'Could not reach Veya. Try again shortly.');}

function renderAccess(){
 const role=currentUser.access?.hostStatus;$('profileRole').textContent=currentUser.access?.canHost ? role==='trial' ? 'Trial host':'Host' : 'Viewer';$('profileSupport').open=Boolean(currentUser.access?.blocked);
 const a=currentUser.access || {};$('accessStatus').textContent=a.blocked ? `Access suspended: ${a.blockReason}` : a.accessAllowed ? 'Tester access approved. You can watch and chat.' : 'Tester access is waiting for admin approval. Share your account ID with the admin.';
 $('applyHost').hidden=!a.accessAllowed || a.canHost || a.applicationPending || a.blocked;
 $('trialStatus').textContent=a.hostStatus==='trial' ? `Trial host · ends ${new Date(a.trialEnd).toLocaleDateString()}` : a.applicationPending ? 'Host application received. An admin will review it.' : a.hostStatus==='review' ? 'Your trial has ended. Host access is awaiting review.' : a.canHost ? 'Host access approved.' : 'Viewer account. Streaming needs separate approval.';$('trialStatus').textContent+=` · ${a.liveHours || 0} tracked live hours`;
 $('accessStatus').hidden=Boolean(a.accessAllowed && !a.blocked);$('trialStatus').hidden=Boolean(a.hostStatus==='viewer' && !a.applicationPending);$('profile').querySelector('.profile-access').hidden=Boolean(a.accessAllowed && !a.blocked && $('applyHost').hidden && $('trialStatus').hidden);
 $('accountPhone').value=a.phone || '';
}
async function loadOwnAccess(){if(!currentUser)return;try{const result=await api('/api/access');currentUser.access=result.access;updateAccount(currentUser);renderAccess();$('myAppeals').replaceChildren();for(const appeal of result.appeals){const item=document.createElement('p');item.textContent=`${appeal.status}: ${appeal.message}${appeal.response ? ' · Admin: '+appeal.response : ''}`;$('myAppeals').append(item);}}catch(e){notice(e.message);}}
$('applyHost').onclick=()=>{$('hostBio').value=currentUser.bio || '';$('hostApplyDialog').showModal();};$('cancelHostApply').onclick=()=>$('hostApplyDialog').close();
$('hostApplicationForm').onsubmit=async e=>{e.preventDefault();try{const result=await api('/api/host/apply',{bio:$('hostBio').value,languages:$('hostLanguages').value,experience:$('hostExperience').value,socialLinks:$('hostLinks').value,contact:$('hostContact').value});currentUser=result.user;$('hostApplyDialog').close();renderAccess();notice('Application received.');}catch(e){notice(e.message);}};
$('phoneForm').onsubmit=async e=>{e.preventDefault();try{currentUser=(await api('/api/access/phone',{phone:$('accountPhone').value})).user;renderAccess();notice('Phone number saved.');}catch(e){notice(e.message);}};
$('appealForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/access/appeal',{message:$('appealMessage').value});$('appealMessage').value='';await loadOwnAccess();notice('Appeal received.');}catch(e){notice(e.message);}};

function actionButton(label,action){const b=textElement('button',label);b.className='btn quiet';b.type='button';b.onclick=action;return b;}
async function adminAction(input){try{await api('/api/admin/manage',input);await loadManagement();notice('Saved.');}catch(e){notice(e.message);}}
function renderMembers(){
 $('members').replaceChildren();const q=$('memberSearch').value.toLowerCase();
 for(const m of managementData.members.filter(m=>`${m.name} ${m.email}`.toLowerCase().includes(q))){
 const card=document.createElement('div');card.className='admin-member';card.append(textElement('h2',m.name),textElement('p',`${m.email} · ${m.country || 'Country pending'} · ${m.id}`),textElement('p',`Tester: ${m.tester ? 'approved':'pending'} · Host: ${m.host_status || 'viewer'}`));
 if(m.application){let application;try{application=JSON.parse(m.application);}catch{application={};}card.append(textElement('pre',Object.entries(application).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join('\n')));}
 if(managementData.permissions.includes('testers'))card.append(actionButton(m.tester?'Remove tester access':'Approve tester',()=>adminAction({action:'tester',userId:m.id,approved:!m.tester})));
 if(managementData.permissions.includes('hosts')){const row=document.createElement('div');row.className='row wrap';const select=document.createElement('select');select.setAttribute('aria-label','Host decision for '+m.name);for(const [v,label] of [['trial','Start / extend trial'],['approved','Approve after trial'],['viewer','Revoke host access'],['rejected','Reject application']]){const o=textElement('option',label);o.value=v;select.append(o);}const days=document.createElement('input');days.type='number';days.min=1;days.max=365;days.value=managementData.settings?.trialDays || 15;days.setAttribute('aria-label','Trial days for '+m.name);row.append(select,days,actionButton('Save host decision',()=>adminAction({action:'host',userId:m.id,status:select.value,days:Number(days.value)})));card.append(row);}
 if(managementData.permissions.includes('moderation')){card.append(textElement('p',`Last IP: ${m.last_ip || 'Unavailable'} · Phone: ${m.phone || 'Not supplied'} (unverified)`));const row=document.createElement('div');row.className='row wrap';const kind=document.createElement('select');kind.setAttribute('aria-label','Suspension type');for(const x of ['account','phone','ip']){const o=textElement('option',x);o.value=x;kind.append(o);}const days=document.createElement('input');days.type='number';days.min=0;days.max=365;days.value=0;days.setAttribute('aria-label','Suspension days, zero is permanent');const reason=document.createElement('input');reason.placeholder='Suspension reason';reason.maxLength=500;reason.setAttribute('aria-label','Suspension reason');row.append(kind,days,reason,actionButton('Suspend',()=>adminAction({action:'block',userId:m.id,kind:kind.value,days:Number(days.value),reason:reason.value})));card.append(row);}
 if(managementData.owner){const box=document.createElement('div');for(const permission of ['testers','hosts','moderation','settings','appeals']){const label=document.createElement('label');label.className='permission-check';const input=document.createElement('input');input.type='checkbox';input.value=permission;input.checked=m.permissions?.includes(permission);label.append(input,document.createTextNode(permission));box.append(label);}box.append(actionButton('Save admin permissions',()=>adminAction({action:'permissions',userId:m.id,permissions:[...box.querySelectorAll('input:checked')].map(x=>x.value)})));card.append(box);}
 $('members').append(card);
 }
}
async function loadManagement(){
 managementData=await api('/api/admin/management');$('management').hidden=false;$('reports').hidden=true;$('adminReportsTab').hidden=!managementData.permissions.includes('moderation');renderMembers();$('trialSettings').replaceChildren();
 if(managementData.settings){const s=managementData.settings;const form=document.createElement('form');form.className='card';form.append(textElement('h2','Trial and access settings'),textElement('p','Trial length changes apply to new or extended trials. The outcome rule applies when a trial expires. Payment values are planning settings; purchases and payouts are not active.'));const grid=document.createElement('div');grid.className='settings-grid';const inputs={};for(const [field,label] of [['trialDays','Trial length (days)'],['minimumHours','Required hours per period'],['minimumDays','Required streaming days'],['dailyHourCap','Daily qualifying hour cap (0 = none)'],['trialAmount','Planned trial payment amount']]){const wrap=document.createElement('div');const labelNode=textElement('label',label);const input=document.createElement('input');input.type='number';input.min=field==='trialDays'?1:0;input.step=field==='trialDays'||field==='minimumDays'?1:.25;input.value=s[field];input.setAttribute('aria-label',label);inputs[field]=input;wrap.append(labelNode,input);grid.append(wrap);}form.append(grid);
 for(const [field,label] of [['testingApproval','Require admin approval for tester access'],['paidTrial','Mark trials as part of the planned paid programme']]){const wrap=document.createElement('label');wrap.className='check';const input=document.createElement('input');input.type='checkbox';input.checked=s[field];inputs[field]=input;wrap.append(input,document.createTextNode(label));form.append(wrap);}
 const outcome=document.createElement('select');outcome.setAttribute('aria-label','After trial expires');for(const [value,label] of [['review','Pause hosting until reviewed'],['continue','Automatically approve continued hosting']]){const option=textElement('option',label);option.value=value;outcome.append(option);}outcome.value=s.trialOutcome;form.append(textElement('label','After trial expires'),outcome);const submit=textElement('button','Save settings');submit.className='btn wide';form.append(submit);form.onsubmit=e=>{e.preventDefault();const input={action:'settings',trialOutcome:outcome.value};for(const [key,el] of Object.entries(inputs))input[key]=el.type==='checkbox'?el.checked:Number(el.value);void adminAction(input);};$('trialSettings').append(form);}
 $('blocks').replaceChildren();if(managementData.blocks.length)$('blocks').append(textElement('h2','Active suspensions'));for(const b of managementData.blocks){const card=document.createElement('div');card.className='admin-member';card.append(textElement('p',`${b.kind}: ${b.value} · ${b.reason} · ${b.expires_at?new Date(b.expires_at).toLocaleString():'Permanent'}`),actionButton('Lift suspension',()=>adminAction({action:'unblock',blockId:b.id})));$('blocks').append(card);}
 $('adminAppeals').replaceChildren();if(managementData.appeals.length)$('adminAppeals').append(textElement('h2','Appeals'));for(const a of managementData.appeals){const card=document.createElement('div');card.className='admin-member';const response=document.createElement('textarea');response.value=a.response;response.maxLength=1000;response.setAttribute('aria-label','Reply to appeal');card.append(textElement('h2',a.name),textElement('p',`${a.status}: ${a.message}`),response,actionButton('Reply and mark reviewed',()=>adminAction({action:'appeal',appealId:a.id,status:'reviewed',response:response.value})));$('adminAppeals').append(card);}
}
$('memberSearch').oninput=()=>{if(managementData)renderMembers();};$('adminAccessTab').onclick=()=>loadManagement().catch(e=>notice(e.message));$('adminReportsTab').onclick=async()=>{try{await loadReports();$('management').hidden=true;$('reports').hidden=false;}catch(e){notice(e.message);}};

$('navFollowing').onclick=()=>navigate('following');$('navUpdates').onclick=()=>navigate('updates');$('navHost').onclick=()=>navigate('hostHub');
$('closePublicProfile').onclick=()=>$('publicProfileDialog').close();
async function openPublicProfile(id){try{const {profile:p}=await api('/api/public-profile?id='+encodeURIComponent(id));paintProfileDetails('public',p);paintAvatar($('publicAvatar'),p.displayName,p.avatar);$('publicName').textContent=p.displayName;$('publicBio').textContent=p.bio || '';$('publicAboutSection').hidden=!p.bio;$('publicHobbiesSection').hidden=!p.hobbies?.length;$('publicCountry').textContent=config.countries?.find(c=>c.code===p.country)?.name || p.country;$('publicRole').textContent=p.isHost?'Host':'Viewer';$('publicFollowers').textContent=p.followers;$('publicFollowing').textContent=p.following;$('followHost').hidden=p.id===currentUser.id || (!p.isHost && !p.isFollowing);$('followHost').textContent=p.isFollowing?'Unfollow':'Follow';$('followHost').onclick=async()=>{try{await api('/api/follow',{userId:p.id,enabled:!p.isFollowing});await openPublicProfile(p.id);void loadPeople(false);}catch(e){notice(e.message);}};const {rooms}=await api('/api/rooms');const live=rooms.find(r=>r.hostId===p.id);$('publicPresence').textContent=live?'Live now':p.isHost?'Not live right now':'Veya member';$('publicPresence').dataset.live=String(Boolean(live));$('joinProfileLive').hidden=!live;$('joinProfileLive').onclick=()=>{$('publicProfileDialog').close();requestJoin(live.id);};if(!$('publicProfileDialog').open)$('publicProfileDialog').showModal();}catch(e){notice(e.message);}}
async function loadPeople(following){if(!currentUser?.access?.accessAllowed)return;const target=$(following?'followedHosts':'hostDirectory');try{const {people}=await api('/api/people?'+(following?'following=1':'hosts=1'));target.replaceChildren();if(!people.length){target.append(textElement('p',following?'You haven’t followed any hosts yet. Explore hosts and open their profile to follow.':'Approved hosts will appear here as they join.'));return;}for(const p of people){const card=document.createElement('div');card.className='card person-card';const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,p.displayName,p.avatar);const copy=document.createElement('div');copy.append(textElement('strong',p.displayName),textElement('p',p.bio || (p.isHost?'Veya host':'Veya member')));const button=actionButton('View profile',()=>openPublicProfile(p.id));card.append(avatar,copy,button);target.append(card);}}catch(e){target.textContent=e.message;}}
async function loadUpdates(render=false){if(!currentUser?.access?.accessAllowed)return;try{const result=await api('/api/notifications');notificationItems=result.items;$('navUpdates').textContent=result.unread ? `Updates (${result.unread})`:'Updates';if(!render)return;$('updateList').replaceChildren();if(!result.items.length)$('updateList').append(textElement('p','Your host updates and access decisions will appear here.'));const {rooms}=await api('/api/rooms');for(const n of result.items){const card=document.createElement('div');card.className='card';card.append(textElement('strong',n.message),textElement('p',new Date(n.createdAt).toLocaleString()));if(!n.seen)card.append(textElement('span','Unread'));const live=rooms.find(r=>r.id===n.roomId);if(live)card.append(actionButton('Join live',()=>requestJoin(live.id)));else if(n.kind==='live')card.append(textElement('p','This live has ended.'));$('updateList').append(card);}}catch(e){notice(e.message);}}
$('markUpdatesRead').onclick=async()=>{try{await api('/api/notifications/read',{ids:notificationItems.map(n=>n.id)});await loadUpdates(true);}catch(e){notice(e.message);}};
async function loadHostHub(){try{await loadOwnAccess();const d=await api('/api/host/dashboard');$('hostHubStatus').textContent=$('trialStatus').textContent;$('hostStats').textContent=`${d.stats.hours} live hours · ${d.stats.days} streaming days · ${d.stats.sessions} sessions`;$('hostRequirements').textContent=`Programme planning: ${d.trial.requirements.hours} hours, ${d.trial.requirements.days} days. Payment and withdrawal features are not active.`;$('hubStart').hidden=!currentUser.access.canHost;$('hubApply').hidden=currentUser.access.canHost || currentUser.access.applicationPending || !currentUser.access.accessAllowed;$('hostSessions').replaceChildren();for(const session of d.sessions){$('hostSessions').append(textElement('p',`${new Date(session.startedAt).toLocaleString()} · ${Math.round((session.lastSeen-session.startedAt)/60000)} minutes · ${session.endedAt?'Ended':'Active / last connected'}`));}if(!d.sessions.length)$('hostSessions').textContent='Your completed live sessions will appear here.';}catch(e){notice(e.message);}}
$('hubStart').onclick=()=>navigate('studio');$('hubApply').onclick=()=>$('applyHost').click();
function deviceOptions(){return {audio:$('micDevice').value?{deviceId:{exact:$('micDevice').value}}:true,video:{...($('cameraDevice').value?{deviceId:{exact:$('cameraDevice').value}}:{facingMode:'user'}),resolution:{width:640,height:480,frameRate:24}}};}
function stopPreview(){previewGeneration++;for(const t of previewTracks){t.detach();t.stop();}previewTracks=[];$('cameraPreview').srcObject=null;$('cameraPreview').hidden=true;}
async function populateDevices(){const devices=await navigator.mediaDevices.enumerateDevices();for(const [id,kind] of [['cameraDevice','videoinput'],['micDevice','audioinput']]){const select=$(id),previous=select.value;select.replaceChildren();const defaultOption=textElement('option','Default device');defaultOption.value='';select.append(defaultOption);for(const device of devices.filter(d=>d.kind===kind)){const option=textElement('option',device.label || `${kind==='videoinput'?'Camera':'Microphone'} ${select.options.length}`);option.value=device.deviceId;select.append(option);}select.value=previous;}}
$('previewDevices').onclick=async()=>{if(busy)return;$('previewDevices').disabled=true;try{stopPreview();const generation=previewGeneration;const tracks=await createLocalTracks(deviceOptions());if(generation!==previewGeneration || $('studio').hidden){for(const t of tracks)t.stop();return;}previewTracks=tracks;previewTracks.find(t=>t.kind===Track.Kind.Video)?.attach($('cameraPreview'));$('cameraPreview').hidden=false;await populateDevices();$('deviceStatus').textContent='Preview is local. Change a device and click Check devices again.';}catch(e){stopPreview();$('deviceStatus').textContent=e.name==='NotAllowedError'?'Allow camera and microphone access to check your devices.':e.message;}finally{$('previewDevices').disabled=false;}};
$('stopPreview').onclick=()=>{stopPreview();$('deviceStatus').textContent='Camera preview stopped.';};
setInterval(()=>void loadUpdates(!$('updates').hidden),15000);void loadUpdates();

async function loadProfileStats(){const id=currentUser.id;if(!currentUser.access?.accessAllowed)return;try{const {profile}=await api('/api/public-profile?id='+encodeURIComponent(id));if(currentUser?.id!==id)return;$('profileFollowers').textContent=profile.followers;$('profileFollowing').textContent=profile.following;}catch{}}
$('profileFollowingButton').onclick=()=>navigate('following');$('profileHostButton').onclick=()=>navigate('hostHub');
$('profileSettingsButton').onclick=()=>{$('profileAccountSettings').open=true;$('profileAccountSettings').scrollIntoView({behavior:'smooth',block:'start'});$('profileAccountSettings').querySelector('summary').focus({preventScroll:true});};
$('copyAccountId').onclick=async()=>{try{await navigator.clipboard.writeText(currentUser.id);$('copyIdStatus').textContent='Account ID copied.';}catch{$('copyIdStatus').textContent='Select and copy the account ID above.';}};

function paintProfileDetails(prefix,user){const age=$(prefix==='profile'?'profileAgeLabel':'publicAge');age.hidden=user.age===null || user.age===undefined;age.textContent=age.hidden?'':`${user.age} years old`;const hobbies=$(prefix==='profile'?'profileHobbyTags':'publicHobbyTags');hobbies.replaceChildren();const tags=Array.isArray(user.hobbies)?user.hobbies:[];hobbies.hidden=!tags.length;for(const tag of tags)hobbies.append(textElement('span',tag));}

function renderHobbyPicker(selected){$('profileHobbies').replaceChildren();for(const hobby of config.hobbies || []){const label=document.createElement('label');label.className='hobby-option';const input=document.createElement('input');input.type='checkbox';input.value=hobby;input.checked=selected.includes(hobby);input.onchange=updateHobbyPicker;label.append(input,textElement('span',hobby));$('profileHobbies').append(label);}updateHobbyPicker();}
function updateHobbyPicker(){const inputs=[...$('profileHobbies').querySelectorAll('input')];const count=inputs.filter(x=>x.checked).length;const limit=config.maxHobbies || 6;for(const input of inputs)input.disabled=!input.checked && count>=limit;$('hobbyCount').textContent=`${count} / ${limit} selected`;}
$('viewOwnPublicProfile').onclick=()=>openPublicProfile(currentUser.id);
