import { Room, RoomEvent, Track, createLocalTracks } from '/livekit.js';
const $ = id => document.getElementById(id);
let socket, liveRoom, localTracks = [], cameraEffect = null, previewEffect = null, previewSwitch=Promise.resolve(), activeRoom, role, currentUser, registering = false, busy = false, pendingRoom;
let pendingChat = null, chatStatusTimer, roomConfirmAction = null, guestTracks=[],activeGuest=null,guestPublishing=false,activeBattle=null,battleHideTimer=null;
let liveParticipants=[],giftPending=null,giftWallet=null,giftCollection='Veya';
const giftIds=new Set(['heart','star','flower','crown']);
const sceneGifts=new Set(['snow_leopard','dance_party','football','veya_popper','phoenix','moon_carriage','crystal_rose','golden_butterfly','magic_lantern','treasure_chest','moon_swing','heart_comet','crystal_stag','neon_supercar','sea_dragon','grand_piano','sky_airship','cosmic_whale']);
const flagCodes=new Set(['sa','ae','kw','qa','eg','ps','iq','lb']);
const flagArt=code=>`/gifts/flags/${flagCodes.has(code)?code:'sa'}.svg`;
const giftArt=id=>`/gifts/${giftIds.has(id)?id:'heart'}.svg`;
const giftCode=codepoint=>/^[0-9a-f]+(?:_[0-9a-f]+)*$/.test(codepoint||'')?codepoint:'';
const giftThumb=codepoint=>giftCode(codepoint)?`/gifts/thumbs/${codepoint}.svg`:'';
const giftAnimation=codepoint=>giftCode(codepoint)?`/gifts/animated/${codepoint}.json`:'';
const giftTier=points=>points>=120?'epic':points>=70?'gold':points>=30?'pink':'violet';
let giftSoundEnabled=localStorage.getItem('veyaGiftSound')==='true',giftAudioContext=null;
function unlockGiftAudio(){try{giftAudioContext??=new (window.AudioContext||window.webkitAudioContext)();if(giftAudioContext.state==='suspended')void giftAudioContext.resume();}catch{giftSoundEnabled=false;}}
function playGiftSound(gift,force=false){
 if(!giftSoundEnabled&&!force)return;
 try{
  unlockGiftAudio();const ctx=giftAudioContext;if(!ctx||ctx.state!=='running')return;
  const id=gift.giftId||gift.id||'';const flag=Boolean(gift.flag),premium=gift.atlas==='premium'||gift.points>=120;
  const motifs={crystal_rose:[523,659,784],golden_butterfly:[659,880,988,1175],magic_lantern:[392,587,784],treasure_chest:[392,523,659,1047],moon_swing:[392,523,392],heart_comet:[440,660,880,1320],crystal_stag:[392,587,784,1175],neon_supercar:[220,330,440,660],sea_dragon:[330,440,587,880],grand_piano:[261,329,392,523],sky_airship:[349,440,523,698],cosmic_whale:[196,294,392,587],snow_leopard:[392,587,784],dance_party:[440,554,659,880],football:[330,440,659],veya_popper:[523,659,880],phoenix:[330,523,784,1047],moon_carriage:[349,523,698,1047]};
  const notes=flag?[392,494,587,784]:(motifs[id]||[523,659,784]);const start=ctx.currentTime+.015;const spacing=flag?.19:premium?.19:.14;
  for(let i=0;i<notes.length;i++){
   const at=start+i*spacing,osc=ctx.createOscillator(),gain=ctx.createGain();
   osc.type=flag?'triangle':id==='neon_supercar'?'sawtooth':'sine';osc.frequency.setValueAtTime(notes[i],at);
   if(id==='neon_supercar')osc.frequency.exponentialRampToValueAtTime(notes[i]*1.12,at+.18);
   const volume=(flag?.055:premium?.05:.042)*(i===notes.length-1?1.3:1);
   gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.025);gain.gain.exponentialRampToValueAtTime(.0001,at+(premium?.57:.38));
   osc.connect(gain);gain.connect(ctx.destination);osc.start(at);osc.stop(at+(premium?.59:.4));
  }
 }catch{/* Audio may be blocked until a user gesture; visuals remain available. */}
}
const giftData=new Map();
function loadGiftAnimation(codepoint){
  const path=giftAnimation(codepoint);if(!path)return Promise.reject(Error('No animation'));
  if(!giftData.has(path))giftData.set(path,fetch(path).then(response=>{if(!response.ok)throw Error('Gift animation unavailable');return response.json();}).catch(error=>{giftData.delete(path);throw error;}));
  return giftData.get(path);
}
function giftVisual(gift){
  const wrapper=document.createElement('span');wrapper.className='gift-art';
  if(flagCodes.has(gift.flag)){const flag=document.createElement('span');flag.className='gift-flag-art';const img=document.createElement('img');img.src=flagArt(gift.flag);img.alt='';img.loading='lazy';flag.append(img);wrapper.append(flag);return wrapper;}
  const scene=gift.scene||gift.id||gift.giftId;
  if(sceneGifts.has(scene)){const image=document.createElement('span');image.className='veya-gift-art';image.dataset.scene=scene;if(gift.atlas)image.dataset.atlas=gift.atlas;image.setAttribute('aria-hidden','true');wrapper.append(image);return wrapper;}
  const image=document.createElement('img');image.src=giftThumb(gift.codepoint)||giftArt(gift.id||gift.giftId);image.alt='';image.loading='lazy';image.decoding='async';
  const fallback=document.createElement('span');fallback.className='gift-art-fallback';fallback.textContent=gift.icon||'✦';fallback.hidden=true;
  image.onerror=()=>{const id=gift.id||gift.giftId;if(giftIds.has(id)&&image.src!==new URL(giftArt(id),location.href).href){image.src=giftArt(id);}else{image.hidden=true;fallback.hidden=false;}};
  wrapper.append(image,fallback);return wrapper;
}
let giftQueue=[],giftCelebrationTimer=null,giftAnimating=false,giftGeneration=0,giftPlayer=null;
function resetGiftCelebration(){giftGeneration++;clearTimeout(giftCelebrationTimer);giftCelebrationTimer=null;giftQueue=[];giftAnimating=false;giftPlayer?.destroy();giftPlayer=null;$('giftCelebrationMotion').replaceChildren();$('giftCelebrationMotion').hidden=true;$('giftCelebrationScene').hidden=true;$('giftCelebration').hidden=true;}
function playNextGift(){
  if(giftAnimating||!activeRoom||!giftQueue.length)return;
  giftAnimating=true;const generation=++giftGeneration,gift=giftQueue.shift(),card=$('giftCelebration');
  card.dataset.gift=gift.giftId;card.dataset.tier=giftTier(gift.points);
  giftPlayer?.destroy();giftPlayer=null;const motion=$('giftCelebrationMotion');motion.replaceChildren();motion.hidden=true;
  const scene=$('giftCelebrationScene');scene.hidden=true;delete scene.dataset.atlas;delete scene.dataset.flag;card.classList.toggle('gift-scene-celebration',sceneGifts.has(gift.giftId)||flagCodes.has(gift.flag));
  const art=$('giftCelebrationArt'),fallback=$('giftCelebrationEmoji');fallback.hidden=true;fallback.textContent=gift.icon||'✦';art.hidden=false;
  art.onerror=()=>{if(giftIds.has(gift.giftId)&&art.src!==new URL(giftArt(gift.giftId),location.href).href){art.src=giftArt(gift.giftId);}else{art.hidden=true;fallback.hidden=false;}};
  art.src=giftThumb(gift.codepoint)||giftArt(gift.giftId);
  $('giftCelebrationTitle').textContent=gift.gift;
  $('giftCelebrationDetail').textContent=`${gift.senderName} sent a gift to ${gift.recipientName}`;
  card.hidden=false;playGiftSound(gift);
  const finish=()=>{if(generation!==giftGeneration)return;card.hidden=true;giftPlayer?.destroy();giftPlayer=null;motion.replaceChildren();motion.hidden=true;giftAnimating=false;playNextGift();};
  if(flagCodes.has(gift.flag)){
    art.hidden=true;scene.dataset.flag=gift.flag;scene.dataset.scene=gift.giftId;$('giftCelebrationFlag').src=flagArt(gift.flag);scene.hidden=false;
    scene.style.animation='none';void scene.offsetWidth;scene.style.animation='';giftCelebrationTimer=setTimeout(finish,4200);return;
  }
  if(sceneGifts.has(gift.giftId)){
    art.hidden=true;scene.dataset.scene=gift.giftId;if(gift.atlas)scene.dataset.atlas=gift.atlas;scene.hidden=false;
    // Reset the scene on every send, including consecutive gifts of the same kind.
    scene.style.animation='none';void scene.offsetWidth;scene.style.animation='';
    giftCelebrationTimer=setTimeout(finish,gift.atlas==='premium'||['phoenix','moon_carriage'].includes(gift.giftId)?6000:4200);
    return;
  }
  giftCelebrationTimer=setTimeout(finish,3000);
  loadGiftAnimation(gift.codepoint).then(data=>{
    if(generation!==giftGeneration||card.hidden||!window.lottie)return;
    clearTimeout(giftCelebrationTimer);
    try{giftPlayer=window.lottie.loadAnimation({container:motion,renderer:'svg',loop:false,autoplay:true,animationData:structuredClone(data)});motion.hidden=false;art.hidden=true;fallback.hidden=true;
      const duration=Math.min(4200,Math.max(2300,(data.op-data.ip)/data.fr*1000));giftCelebrationTimer=setTimeout(finish,duration);
    }catch{motion.hidden=true;art.hidden=false;giftCelebrationTimer=setTimeout(finish,2600);}
  }).catch(()=>{});
}
function queueGiftCelebration(gift){giftQueue.push(gift);if(giftQueue.length>4)giftQueue.shift();playNextGift();}
function renderGiftRecipients(){const select=$('giftRecipient'),selected=select.value;select.replaceChildren();for(const person of liveParticipants.filter(p=>p.id!==currentUser?.id)){const option=document.createElement('option');option.value=person.id;option.textContent=person.name;select.append(option);}if([...select.options].some(o=>o.value===selected))select.value=selected;$('giftStatus').textContent=select.options.length?'':'No one else is in this live yet.';renderGiftChoices();}
function renderGiftCollections(){const target=$('giftCollections');target.replaceChildren();for(const collection of ['Veya','Flags','Classic']){if(!giftWallet?.gifts.some(g=>g.category===collection))continue;const button=textElement('button',collection);button.type='button';button.setAttribute('aria-pressed',String(giftCollection===collection));button.onclick=()=>{giftCollection=collection;renderGiftCollections();renderGiftChoices();};target.append(button);}const sound=textElement('button',giftSoundEnabled?'Sound on':'Sound off');sound.type='button';sound.className='gift-audio';sound.setAttribute('aria-label',giftSoundEnabled?'Mute gift sounds':'Enable gift sounds');sound.onclick=()=>{giftSoundEnabled=!giftSoundEnabled;localStorage.setItem('veyaGiftSound',String(giftSoundEnabled));if(giftSoundEnabled)unlockGiftAudio();renderGiftCollections();};target.append(sound);}
function renderGiftChoices(){const target=$('giftChoices');target.replaceChildren();for(const gift of (giftWallet?.gifts||[]).filter(g=>g.category===giftCollection)){const button=document.createElement('button');button.type='button';button.className='gift-choice';button.dataset.gift=gift.id;button.dataset.category=gift.category;button.dataset.tier=giftTier(gift.points);button.disabled=Boolean(giftPending)||!$('giftRecipient').value||giftWallet.balance<gift.points;button.setAttribute('aria-label',`Send ${gift.name} for ${gift.points} test credits`);const copy=document.createElement('span');copy.className='gift-card-copy';const name=document.createElement('strong');name.textContent=gift.name;const cost=document.createElement('small');cost.textContent=gift.points+' credits';copy.append(name,cost);button.append(giftVisual(gift),copy);button.onclick=()=>{const recipient=liveParticipants.find(p=>p.id===$('giftRecipient').value);if(!recipient)return;confirmRoomAction('Send test gift?',`Send ${gift.name} to ${recipient.name} for ${gift.points} test credits?`, 'Send gift',()=>{giftPending=crypto.randomUUID().replaceAll('-','');$('giftStatus').textContent='Sending gift…';send({type:'gift',giftId:gift.id,recipientId:recipient.id,requestId:giftPending});renderGiftChoices();});};target.append(button);}if(!target.children.length)target.append(textElement('p','No gifts are available in this collection.'));}
async function loadGiftWallet(){const {wallet}=await api('/api/gifts/wallet');giftWallet=wallet;$('giftBalance').textContent=String(wallet.balance);if(!wallet.gifts.some(g=>g.category===giftCollection))giftCollection=wallet.gifts[0]?.category||'Veya';renderGiftCollections();renderGiftChoices();return wallet;}
function chatFeedback(message) { clearTimeout(chatStatusTimer); $('chatSendStatus').textContent=message; $('chatSendStatus').hidden=false; chatStatusTimer=setTimeout(()=>{$('chatSendStatus').hidden=true;},2500); }
function confirmRoomAction(title, description, button, action) { roomConfirmAction=action; $('roomConfirmTitle').textContent=title; $('roomConfirmText').textContent=description; $('acceptRoomConfirm').textContent=button; $('roomConfirmDialog').showModal(); }
let adminView='overview', adminOpenMember=null, adminSaving=false, managementData, previewTracks=[], previewGeneration=0, notificationItems=[];
function textElement(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
let config = { mediaConfigured: false, policyVersion: '' };
const status = text => { $('status').textContent = text; };
const notice = text => { $('notice').textContent = text; };
const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
async function api(path, input) {
  const response = await fetch(path, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data;
}
let profileAdminTarget=null,draftBanner='',publicProfileId=null,linkedProfile=/^\/profile\/([0-9a-f]{32})$/.exec(location.pathname)?.[1] || sessionStorage.getItem('veyaProfileLink');
let directoryPeople=[], followingPeople=[], connectionId=null, connectionKind='following', connectionNext=null, connectionVersion=0, peopleVersion=0, peopleSearchTimer, allRooms = [], draftAvatar = '', editingProfile = false;
let activeMessagePeer=null,inboxSection='messages',activityUnread=0,exploreView='live';
let currentCall=null,callRoom=null,callTracks=[],callOptIn=false,callConnecting=false;
function paintAvatar(element, name, avatar = '') {
  element.replaceChildren();
  if (avatar) {const img = document.createElement('img');img.src = avatar;img.alt = '';element.append(img);}
  else element.textContent = (name || 'V').trim().slice(0,1).toUpperCase();
}
function navigate(destination, force = false) {
  if(currentUser && !force && !currentUser.access?.accessAllowed && !currentUser.admin && destination!=='onboarding')destination='profile';
  if(destination==='studio' && !currentUser.access?.canHost){destination='profile';}
  if (!force && (busy || activeRoom)) {notice('Leave your live room first.');return;}
  if(!force && currentCall && destination!=='callScreen'){notice('End your call first.');return;}
  for (const id of ['discover','profile','studio','onboarding','admin','following','updates','messageThread','callScreen','hostHub','rankings','publicProfileDialog']) $(id).hidden = id !== destination;
  $('appNav').hidden = ['onboarding','admin','callScreen'].includes(destination);$('openAdmin').hidden=destination==='admin' || !currentUser?.admin;
  for (const [id,target] of [['navHome','discover'],['navProfile','profile'],['navLive','studio'],['navFollowing','following'],['navUpdates','updates']]) {
    if (target === destination || (id==='navUpdates' && destination==='messageThread') || (id==='navProfile' && destination==='hostHub')) $(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');
  }
  if(destination === 'discover'){selectExplore(exploreView);void refreshRooms();}
  if(destination === 'profile') {renderProfile();void loadOwnAccess();}
  if(destination==='following')void loadConnections();
  if(destination==='updates'){selectInbox(inboxSection);void loadUpdates(true);void loadConversations();}
  if(destination==='hostHub')void loadHostHub();
  if(destination==='rankings')void loadRankings();
  if(destination!=='studio')stopPreview();
  if(destination!=='publicProfileDialog' && /^\/profile\//.test(location.pathname))history.replaceState(null,'','/');
  notice('');window.scrollTo(0,0);
}
function renderRooms() {
  const query = $('roomSearch').value.trim().toLowerCase();
  const matches = allRooms.filter(r => `${r.title} ${r.hostName}`.toLowerCase().includes(query));
  $('roomCount').hidden=!matches.length;
  $('roomCount').textContent = `${matches.length} live ${matches.length === 1 ? 'room' : 'rooms'}`;
  $('rooms').replaceChildren();$('rooms').className = 'rooms-grid';
  if (!matches.length) {
    const empty = document.createElement('div');empty.className='empty';
    const icon=document.createElement('div');icon.className='empty-icon';icon.textContent='✦';icon.setAttribute('aria-hidden','true');
    const title=document.createElement('h2');title.textContent=allRooms.length ? 'No lives match just yet.' : 'It’s quiet right now';
    const text=document.createElement('p');text.textContent=allRooms.length ? 'Try another search or look for a different host.' : 'Follow a host below to catch their next live.';
    const button=document.createElement('button');button.className='btn';button.textContent=allRooms.length ? 'Clear search' : 'Browse hosts';button.onclick=()=>{if(allRooms.length){$('roomSearch').value='';$('clearRoomSearch').hidden=true;renderRooms();renderPeople(false);}else selectExplore('hosts');};
    const copy=document.createElement('div');copy.append(title,text);empty.append(icon,copy);if(allRooms.length)empty.append(button);$('rooms').append(empty);return;
  }
  for (const room of matches) {
    const button=document.createElement('button');button.className='room-item';
    const cover=document.createElement('div');cover.className='room-cover';
    const badge=document.createElement('span');badge.className='live-label';badge.textContent='LIVE';
    const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,room.hostName,room.hostAvatar);cover.append(badge,avatar);
    const copy=document.createElement('div');copy.className='room-copy';const name=document.createElement('strong');name.textContent=room.title;
    const detail=document.createElement('small');detail.textContent=`${room.hostName} · ${room.viewers} viewers`;
    copy.append(name,detail);button.append(cover,copy);button.onclick=()=>requestJoin(room.id);$('rooms').append(button);
  }
}
$('roomSearch').oninput=()=>{renderRooms();$('clearRoomSearch').hidden=!$('roomSearch').value;clearTimeout(peopleSearchTimer);peopleSearchTimer=setTimeout(()=>void loadPeople(false),180);};$('clearRoomSearch').onclick=()=>{$('roomSearch').value='';$('roomSearch').oninput();$('roomSearch').focus();};
async function refreshRooms() {
  if (activeRoom || !currentUser || $('discover').hidden) return;
  try {const {rooms}=await api('/api/rooms');allRooms=rooms;renderRooms();void loadPeople(false);}
  catch(error){$('rooms').textContent=error.message;}
}
function renderProfile() {
  $('profileAdminNotice').hidden=!(currentUser.profileLocked || currentUser.profileRemoved);$('profileAdminNotice').textContent=currentUser.profileRemoved?'Your public profile has been removed. Contact support to request restoration.':'Profile editing is locked. Contact support to request a change.';$('editProfile').disabled=Boolean(currentUser.profileLocked || currentUser.profileRemoved);
  $('accountId').textContent=currentUser.id;renderAccess();
  paintAvatar($('profileAvatar'),currentUser.displayName,currentUser.avatar);
  $('profileHome').dataset.theme=currentUser.theme || 'violet';paintCover($('profileOwnCover'),currentUser.banner);
  paintProfileDetails('profile',currentUser);
  $('profileFollowers').textContent='—';$('profileFollowing').textContent='—';void loadProfileStats();void loadOwnProgression();
  $('viewOwnPublicProfile').hidden=!currentUser.access?.accessAllowed || currentUser.profileRemoved;$('postProfilePhoto').hidden=!currentUser.access?.accessAllowed || currentUser.profileRemoved;$('postProfilePhoto').disabled=Boolean(currentUser.profileLocked);
  $('profileCountryLabel').textContent='Country or region: '+(config.countries?.find(c=>c.code===currentUser.country)?.name || currentUser.country);
  $('profileOwnCountry').textContent=config.countries?.find(c=>c.code===currentUser.country)?.name || currentUser.country || 'Choose country';
  $('profileDisplayName').textContent=currentUser.displayName;$('profileAbout').textContent=currentUser.bio || '';
}
function setProfileStep() {
  $('cancelProfile').hidden=!editingProfile;
  $('onboardingProgress').textContent=editingProfile ? 'Your profile' : 'Make yourself at home';
  $('onboardingTitle').textContent=editingProfile ? 'Make it yours.' : 'A little about you.';
  $('onboardingSubtitle').textContent='Choose your name and country. Photo and bio are optional.';
  $('profileNext').textContent=editingProfile ? 'Save profile' : 'Enter Veya';$('profileError').textContent='';
}
function openProfileSetup(editing=false,target=null) {
  profileAdminTarget=target;const profileUser=target || currentUser;
  $('optionalProfileDetails').hidden=!editing;$('profileAge').value=profileUser.age ?? '';renderHobbyPicker(profileUser.hobbies || []);
  editingProfile=editing;$('profileCountry').value=profileUser.country || '';draftAvatar=profileUser.avatar || '';$('profileName').value=profileUser.displayName;$('profileBio').value=profileUser.bio || '';
  $('onboardingAdult').checked=profileUser.adult;$('onboardingAdultLabel').hidden=profileUser.adult;paintAvatar($('avatarPreview'),profileUser.displayName,draftAvatar);
  draftBanner=profileUser.banner || '';$('profileTheme').value=profileUser.theme || 'violet';paintCover($('bannerPreview'),draftBanner);
  setProfileStep(1);navigate('onboarding');if(target){$('onboardingTitle').textContent='Edit '+target.displayName;$('onboardingSubtitle').textContent='Administrator changes to this profile.';$('onboardingAdultLabel').hidden=true;}
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
$('cancelProfile').onclick=()=>navigate(profileAdminTarget?'admin':'profile');
$('profileForm').onsubmit=async event=>{
  event.preventDefault();$('profileError').textContent='';
  if(!profileAdminTarget && !currentUser.adult && !$('onboardingAdult').checked){$('profileError').textContent='Confirm you are 18 or older to continue.';return;}
  $('profileNext').disabled=true;
  try{const input={displayName:$('profileName').value,country:$('profileCountry').value,bio:$('profileBio').value,age:$('profileAge').value===''?null:Number($('profileAge').value),hobbies:[...$('profileHobbies').querySelectorAll('input:checked')].map(x=>x.value),avatar:draftAvatar,banner:draftBanner,theme:$('profileTheme').value,interests:[],adult:$('onboardingAdult').checked};
    if(profileAdminTarget){await api('/api/admin/profile',{userId:profileAdminTarget.id,action:'save',profile:input});profileAdminTarget=null;await loadManagement();currentUser=(await api('/api/me')).user;navigate('admin');notice('Profile updated.');}
    else{const {user}=await api('/api/profile',input);const wasEditing=editingProfile;await showSignedIn(user);if(wasEditing)navigate('profile');}}

  catch(e){$('profileError').textContent=e.message;}finally{$('profileNext').disabled=false;}
};
$('navHome').onclick=()=>navigate('discover');$('navProfile').onclick=()=>navigate('profile');$('navLive').onclick=()=>navigate('studio');$('backFromStudio').onclick=()=>navigate('discover');$('editProfile').onclick=()=>openProfileSetup(true);
function requestJoin(id) { if (busy || activeRoom) return;if(!currentUser.access?.accessAllowed){navigate('profile');notice('Tester access is waiting for admin approval.');return;} if(!currentUser.adult || (config.accounts?.email && !currentUser.emailVerified)){navigate('profile');notice('Verify your email before joining a live.');return;} pendingRoom = id; $('viewerRules').checked = false; $('joinDialog').showModal(); }
function updateWatermark() {
  if (!activeRoom) return;
  $('watermark').textContent = `Veya · ${currentUser.displayName} · ${currentUser.id.slice(0, 8)} · ${new Date().toLocaleTimeString()}`;
}
function stopGuestCamera(){for(const track of guestTracks){track.detach();track.stop();}guestTracks=[];guestPublishing=false;$('guestVideo').srcObject=null;$('guestAudio').srcObject=null;$('guestMute').hidden=true;$('leaveGuest').hidden=true;}
function paintGuestState(guest){
  if(!guest){activeGuest=null;stopGuestCamera();$('guestTile').hidden=true;$('removeGuest').hidden=true;$('startBattle').hidden=true;$('battleHint').hidden=true;return;}
  activeGuest=guest;$('guestName').textContent=guest.id===currentUser.id?'You · guest':guest.name+' · guest';$('removeGuest').hidden=role!=='host';
  $('startBattle').hidden=role!=='host'||Boolean(activeBattle?.active);$('battleHint').hidden=role!=='host';
  if(guest.id===currentUser.id){$('guestVideo').muted=true;$('guestTile').hidden=!guestTracks.length;$('guestMute').hidden=!guestTracks.length;$('leaveGuest').hidden=false;}
  else {const participant=liveRoom?.remoteParticipants.get(guest.id);for(const pub of participant?.trackPublications.values()||[]){if(!pub.track)continue;if(pub.track.kind===Track.Kind.Video){pub.track.attach($('guestVideo'));$('guestTile').hidden=false;}else if(pub.track.kind===Track.Kind.Audio)pub.track.attach($('guestAudio'));}}
}
function paintBattle(battle){clearTimeout(battleHideTimer);activeBattle=battle;if(!battle){$('battleBoard').hidden=true;$('startBattle').hidden=role!=='host'||!activeGuest;return;}
 $('battleBoard').hidden=false;$('startBattle').hidden=true;$('battleScore').textContent=`${battle.hostName} ${battle.hostPoints} : ${battle.guestPoints} ${battle.guestName}`;
 if(battle.active){$('battleClock').textContent=`${Math.max(0,Math.ceil((battle.endsAt-Date.now())/1000))}s left`;}else{
  $('battleClock').textContent=battle.hostPoints===battle.guestPoints?'Draw · test gifts':`${battle.hostPoints>battle.guestPoints?battle.hostName:battle.guestName} wins · test gifts`;
  battleHideTimer=setTimeout(()=>{activeBattle=null;$('battleBoard').hidden=true;$('startBattle').hidden=role!=='host'||!activeGuest;},6500);
 }
}
setInterval(()=>{if(activeBattle?.active&&!$('battleBoard').hidden)$('battleClock').textContent=`${Math.max(0,Math.ceil((activeBattle.endsAt-Date.now())/1000))}s left`;},1000);
$('startBattle').onclick=()=>confirmRoomAction('Start a test gift battle?','For three minutes, gifts sent to you or your guest add to your separate scores. No money or prizes are awarded.','Start battle',()=>{send({type:'start-battle'});$('viewersPanel').hidden=true;});
async function publishGuestCamera(){if(guestPublishing||!liveRoom||!activeRoom)return;guestPublishing=true;try{
  for(let attempt=0;attempt<30&&!liveRoom.localParticipant.permissions?.canPublish;attempt++)await new Promise(r=>setTimeout(r,100));
  if(!liveRoom.localParticipant.permissions?.canPublish)throw Error('Camera permission did not become ready');
  const tracks=await createLocalTracks({audio:true,video:true});guestTracks=tracks;
  for(const track of tracks)await liveRoom.localParticipant.publishTrack(track,{source:track.kind===Track.Kind.Video?Track.Source.Camera:Track.Source.Microphone});
  tracks.find(t=>t.kind===Track.Kind.Video)?.attach($('guestVideo'));send({type:'guest-ready'});$('guestTile').hidden=false;$('guestMute').hidden=false;$('leaveGuest').hidden=false;status('You are on camera with the host.');
 }catch(e){stopGuestCamera();send({type:'leave-guest'});status(e.name==='NotAllowedError'?'Allow camera and microphone to join as a guest.':e.message);}finally{guestPublishing=false;}}
$('guestDecline').onclick=()=>{$('guestInviteDialog').close();send({type:'respond-guest',accept:false});};
$('guestAccept').onclick=()=>{$('guestInviteDialog').close();send({type:'respond-guest',accept:true});};
$('guestMute').onclick=async()=>{const track=guestTracks.find(t=>t.kind===Track.Kind.Audio);if(!track)return;await(track.isMuted?track.unmute():track.mute());$('guestMute').innerHTML=track.isMuted?'◉ <span>Unmute</span>':'◉ <span>Guest mic</span>';};
$('leaveGuest').onclick=()=>confirmRoomAction('Leave the guest camera?','You will remain in the live as a viewer.','Leave camera',()=>send({type:'leave-guest'}));
$('removeGuest').onclick=()=>confirmRoomAction('Remove guest camera?','The guest will remain in the live as a viewer.','Remove guest',()=>send({type:'remove-guest'}));
function showRoom(room) {
  resetGiftCelebration();
  activeGuest=null;guestTracks=[];guestPublishing=false;activeBattle=null;clearTimeout(battleHideTimer);$('battleBoard').hidden=true;$('startBattle').hidden=true;$('battleHint').hidden=true;$('guestTile').hidden=true;$('guestInviteDialog').close();$('guestMute').hidden=true;$('leaveGuest').hidden=true;$('removeGuest').hidden=true;
  for(const id of ['discover','profile','studio','onboarding','following','updates','messageThread','callScreen','hostHub','rankings','publicProfileDialog'])$(id).hidden=true;$('appNav').hidden=true; $('room').hidden = false; $('roomTitle').textContent = room.title;
  $('local').hidden = role !== 'host'; $('remote').hidden = role === 'host'; $('mute').hidden = role !== 'host';
  $('viewersPanel').hidden = true;$('giftPanel').hidden=true;liveParticipants=[];giftPending=null; $('openViewers').hidden = role !== 'host'; $('leave').setAttribute('aria-label',role === 'host' ? 'End live' : 'Leave live'); $('chatSendStatus').hidden=true; pendingChat=null;
  $('mute').innerHTML = '◉ <span>Mic on</span>'; $('openLiveFilters').hidden=role!=='host' || !cameraFiltersSupported();$('chatLog').replaceChildren(); $('viewerList').replaceChildren(); $('viewerCount').textContent = '0';$('stageViewerCount').textContent='0';
  updateWatermark();
}
async function attachMedia(credentials, roomInfo) {
  const room = new Room({ adaptiveStream: true, dynacast: true }); liveRoom = room;
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (participant.identity!==roomInfo.hostId) {
      if(participant.identity!==activeGuest?.id)return;
      if(track.kind===Track.Kind.Video){track.attach($('guestVideo'));$('guestTile').hidden=false;}
      if(track.kind===Track.Kind.Audio)track.attach($('guestAudio'));
      return;
    }
    if (track.kind === Track.Kind.Video) track.attach($('remote'));
    if (track.kind === Track.Kind.Audio) { track.attach($('remoteAudio')); $('hearAudio').hidden = room.canPlaybackAudio; }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => { $('hearAudio').hidden = role === 'host' || room.canPlaybackAudio; });
  room.on(RoomEvent.TrackUnsubscribed,track=>track.detach());
  room.on(RoomEvent.Reconnecting, () => status('Reconnecting to the live…'));
  room.on(RoomEvent.Reconnected, () => status(role === 'host' ? 'You’re live' : 'Watching live'));
  room.on(RoomEvent.Disconnected, () => { if (liveRoom === room && activeRoom) { cleanup(); notice('The live connection ended.'); } });
  await room.connect(credentials.url, credentials.token);
  if (liveRoom !== room || !activeRoom) { await room.disconnect(); throw Error('Room closed'); }
  if (role === 'host') {
    for (const track of localTracks) {
      const camera=track.kind===Track.Kind.Video,raw=camera?track.mediaStreamTrack:track,output=camera && cameraEffectActive() ? await createCameraEffect(track) || raw : raw;
      const publication=await room.localParticipant.publishTrack(output,{source:camera?Track.Source.Camera:Track.Source.Microphone});
      if(camera){publication.track.attach($('local'));$('local').dataset.filtered=String(output!==raw);}
    }
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
        if (msg.userId === currentUser?.id && pendingChat === msg.text) { pendingChat=null; chatFeedback('Sent ✓'); }
        if ($('chatLog').children.length > 100) $('chatLog').firstChild.remove(); $('chatLog').scrollTop = $('chatLog').scrollHeight;
      }
      if(msg.type==='participants'){liveParticipants=msg.participants;renderGiftRecipients();}
      if(msg.type==='guest-invite'){$('guestInviteText').textContent=`${msg.hostName} invited you to join this live on camera.`;$('guestInviteDialog').showModal();}
      if(msg.type==='guest-invite-sent')status(`Invitation sent to ${msg.name}.`);
      if(msg.type==='guest-declined')status(`${msg.name||'The host'} declined the invitation.`);
      if(msg.type==='guest-accepted')void publishGuestCamera();
      if(msg.type==='guest-state')paintGuestState(msg.guest);
      if(msg.type==='battle-state')paintBattle(msg.battle);
      if(msg.type==='guest-removed'||msg.type==='guest-ended'){stopGuestCamera();if(msg.type==='guest-removed')status('You left the guest camera.');}
      if(msg.type==='gift'){
        const item=document.createElement('li');item.className='room-gift';item.append(giftVisual(msg),document.createTextNode(`${msg.senderName} sent ${msg.icon} ${msg.gift} to ${msg.recipientName}`));$('chatLog').append(item);if($('chatLog').children.length>100)$('chatLog').firstChild.remove();$('chatLog').scrollTop=$('chatLog').scrollHeight;queueGiftCelebration(msg);
      }
      if(msg.type==='gift-sent' && msg.requestId===giftPending){giftPending=null;if(giftWallet)giftWallet.balance=msg.balance;$('giftBalance').textContent=String(msg.balance);$('giftStatus').textContent='Gift sent ✓';renderGiftChoices();}
      if(msg.type==='gift-error' && msg.requestId===giftPending){giftPending=null;$('giftStatus').textContent=msg.message;renderGiftChoices();}
      if (msg.type === 'viewers') {$('viewerCount').textContent = msg.count;$('stageViewerCount').textContent=msg.count;}
      if (msg.type === 'roster') {
        $('viewerList').replaceChildren();
        if (!msg.viewers.length) $('viewerList').textContent = 'Waiting for your first viewer.';
        for (const viewer of msg.viewers) {
          const row = document.createElement('div'); row.className = 'viewer'; const name = document.createElement('span'); name.textContent = viewer.name;
          const actions=document.createElement('div');actions.className='viewer-actions';if(viewer.canGuest&&!viewer.guest&&!msg.viewers.some(v=>v.guest)){const invite=document.createElement('button');invite.className='btn secondary';invite.textContent='Invite on camera';invite.onclick=()=>{send({type:'invite-guest',userId:viewer.id});$('viewersPanel').hidden=true;};actions.append(invite);}
          const button = document.createElement('button'); button.className = 'btn danger'; button.textContent = 'Remove'; button.onclick = () => confirmRoomAction('Remove viewer?', `${viewer.name} will leave this live and its chat.`, 'Remove', () => { send({ type: 'kick', userId: viewer.id }); $('viewersPanel').hidden=true; status(`${viewer.name} removed from this live.`); }); actions.append(button);row.append(name,actions); $('viewerList').append(row);
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
  resetGiftCelebration();
  stopGuestCamera();activeGuest=null;$('guestTile').hidden=true;$('guestInviteDialog').close();
  activeBattle=null;clearTimeout(battleHideTimer);$('battleBoard').hidden=true;
  stopPreview();stopCameraEffect();activeRoom = null; const room = liveRoom; liveRoom = null; void room?.disconnect();
  for (const track of localTracks) { track.detach(); track.stop(); } localTracks = [];
  const ws = socket; socket = null; ws?.close();
  for (const id of ['local', 'remote', 'remoteAudio']) $(id).srcObject = null;
  $('room').hidden = true; for(const id of ['discover','profile','studio','onboarding','following','updates','messageThread','callScreen','hostHub','rankings','publicProfileDialog'])$(id).hidden=true;$('appNav').hidden=!currentUser;if(currentUser){if(currentUser.onboarded)navigate(currentUser.access?.accessAllowed?'discover':'profile',true);else openProfileSetup();} $('hearAudio').hidden = true;
  $('reportDialog').close(); $('joinDialog').close(); $('roomConfirmDialog').close(); closeLiveFilters(); $('viewersPanel').hidden=true;$('giftPanel').hidden=true;giftPending=null;liveParticipants=[]; $('chatLog').replaceChildren(); pendingChat=null;clearTimeout(chatStatusTimer);
  history.replaceState(null, '', location.pathname); refreshRooms();
}
function startFieldError(id,message){$(id).textContent=message;$(id).hidden=!message;}
$('title').oninput=()=>{startFieldError('titleError','');$('title').removeAttribute('aria-invalid');startFieldError('startError','');};
$('hostRules').onchange=()=>{if($('hostRules').checked)startFieldError('hostRulesError','');};
$('start').onclick = async () => {
  if (busy) return; notice('');startFieldError('titleError','');startFieldError('hostRulesError','');startFieldError('startError','');
  const title=$('title').value.trim();
  if (title.length<3) {startFieldError('titleError',title?'Use at least 3 characters for the room title.':'Enter a room title to go live.');$('title').setAttribute('aria-invalid','true');$('title').focus();return;}
  $('title').removeAttribute('aria-invalid');
  if (!$('hostRules').checked) {startFieldError('hostRulesError','Accept the room rules before going live.');$('hostRules').focus();return;}
  if (!config.mediaConfigured) {startFieldError('startError','Live video is not connected yet. Try again later.');return;}
  if(!currentUser.access?.accessAllowed || !currentUser.access?.canHost){navigate('profile');notice('Streaming requires host approval.');return;}
  busy = true; $('start').disabled = true; role = 'host';
  try {
    stopPreview();localTracks = await createLocalTracks(deviceOptions());
    await connect({ type: 'create', title, acceptRules: true, policyVersion: config.policyVersion });
  } catch (error) { const message=error.name === 'NotAllowedError' ? 'Allow camera and microphone access, then try again.' : error.message;cleanup();navigate('studio',true);startFieldError('startError',message); }
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
$('mute').onclick = async () => { const track = localTracks.find(t => t.kind === Track.Kind.Audio); if (!track) return; await (track.isMuted ? track.unmute() : track.mute()); $('mute').innerHTML = track.isMuted ? '◉ <span>Mic off</span>' : '◉ <span>Mic on</span>'; $('mute').setAttribute('aria-label',track.isMuted?'Unmute mic':'Mute mic'); };
$('hearAudio').onclick = async () => { await liveRoom?.startAudio(); $('hearAudio').hidden = true; };
$('cancelRoomConfirm').onclick=()=>{$('roomConfirmDialog').close();roomConfirmAction=null;};
$('acceptRoomConfirm').onclick=()=>{const action=roomConfirmAction;roomConfirmAction=null;$('roomConfirmDialog').close();action?.();};
$('leave').onclick = () => { if(role==='host')confirmRoomAction('End live?', 'This ends the live for everyone watching.', 'End live', cleanup); else cleanup(); }; $('openViewers').onclick=()=>{$('viewersPanel').hidden=false;};$('closeViewers').onclick=()=>{$('viewersPanel').hidden=true;};
$('openGifts').onclick=async()=>{if(giftPending)return;$('viewersPanel').hidden=true;$('giftPanel').hidden=false;$('giftStatus').textContent='';renderGiftRecipients();try{await loadGiftWallet();}catch(error){$('giftStatus').textContent=error.message;}};
$('closeGifts').onclick=()=>{$('giftPanel').hidden=true;};$('giftRecipient').onchange=renderGiftChoices;
$('chatForm').onsubmit = event => { event.preventDefault(); const text=$('chatText').value.trim(); if(!text)return; if(socket?.readyState!==WebSocket.OPEN){chatFeedback('Not connected. Try again.');return;} pendingChat=text;send({ type: 'chat', text });$('chatText').value='';chatFeedback('Sending…'); };
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
  currentUser=user;updateAccount(user);$('account').hidden=true;$('openAdmin').hidden=!user.admin;
  if(!user.onboarded){openProfileSetup();return;}
  navigate(user.access?.accessAllowed ? 'discover' : 'profile');await refreshRooms();
  if(linkedProfile && user.access?.accessAllowed){const id=linkedProfile;linkedProfile=null;sessionStorage.removeItem('veyaProfileLink');await openPublicProfile(id);}
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
$('logout').onclick = async () => { try { await api('/api/logout', {}); resetCall(); callOptIn=false; currentUser = null; cleanup(); $('admin').hidden = true; $('account').hidden = false; $('appNav').hidden=true; $('openAdmin').hidden = true; notice('Signed out.'); } catch (error) { notice(error.message); } };
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
$('closeAdmin').onclick = () => navigate('discover');$('closeGiftPreview').onclick=()=>$('giftPreviewDialog').close();
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
  $('navLiveLabel').textContent=user.access?.canHost ? 'Go live' : 'Host';$('navLive').setAttribute('aria-label',user.access?.canHost?'Go live':'Apply to become a host');
  $('start').disabled = !user.access?.canHost || !user.access?.accessAllowed || !config.mediaConfigured || !user.adult || Boolean(config.accounts?.email && !user.emailVerified);
  if (config.accounts?.email && !user.emailVerified) $('emailStatus').closest('details').open = true;
}
for (const button of document.querySelectorAll('[data-provider]')) button.onclick = () => { if(linkedProfile)sessionStorage.setItem('veyaProfileLink',linkedProfile);location.href = `/auth/${button.dataset.provider}`; };
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
 $('profileHostButton').hidden=!a.canHost && !a.applicationPending && ['viewer','rejected'].includes(a.hostStatus);
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
async function adminAction(input){if(adminSaving)return;adminSaving=true;$('adminSaveStatus').textContent='Saving…';try{await api('/api/admin/manage',input);await loadManagement();$('adminSaveStatus').textContent='Changes saved.';}catch(e){$('adminSaveStatus').textContent=e.message;}finally{adminSaving=false;}}
function memberStatus(m){return m.host_status==='trial' && m.trial_end<=Date.now()?'review':m.host_status || 'viewer';}
function isTestAccount(m){return /@example\.test$/i.test(m.email || '');}
function adminMembers(){return managementData.members.filter(m=>!isTestAccount(m) || (managementData.owner && $('adminShowTestAccounts').checked));}
function adminAppeals(){const tests=new Set(managementData.members.filter(isTestAccount).map(m=>m.id));return managementData.appeals.filter(a=>!tests.has(a.user_id) || (managementData.owner && $('adminShowTestAccounts').checked));}
function pendingTester(m){return !m.tester && !(managementData.owner && m.id===currentUser.id);}
function detailGroup(title){const collapsed=['Suspension','Admin permissions'].includes(title);const div=document.createElement(collapsed?'details':'div');div.className='admin-detail-group';div.append(textElement(collapsed?'summary':'h3',title));return div;}
function labelledAdminInput(label,el){const wrap=document.createElement('div');const text=textElement('label',label);el.setAttribute('aria-label',label);wrap.append(text,el);return wrap;}
function renderMembers(){
 $('members').replaceChildren();const q=$('memberSearch').value.trim().toLowerCase();const filter=$('memberFilter').value;
 const matches=adminMembers().filter(m=>{const status=memberStatus(m);if(!`${m.name} ${m.email} ${m.id}`.toLowerCase().includes(q))return false;if(adminView==='applications' && status!=='pending')return false;if(adminView==='trials' && !['trial','review'].includes(status))return false;if(adminView==='team' && !m.permissions?.length)return false;if(adminView==='overview' && !pendingTester(m) && status!=='pending' && status!=='review')return false;if(adminView!=='accounts')return true;return filter==='all'||(filter==='pending'&&pendingTester(m))||(filter==='viewers'&&['viewer','rejected'].includes(status))||(filter==='hosts'&&['trial','approved','review'].includes(status))||(filter==='admins'&&m.permissions?.length);});
 $('adminMemberCount').textContent=`${matches.length} ${matches.length===1?'account':'accounts'}`;
 if(!matches.length){$('members').append(textElement('p',adminView==='overview'?'No accounts need a decision right now.':q?'No accounts match your search.':'Nothing to review in this section.'));$('members').firstChild.className='admin-empty';return;}
 for(const m of matches){const status=memberStatus(m);const ownOwner=managementData.owner && m.id===currentUser.id;const card=document.createElement('details');card.className='admin-member';card.open=adminOpenMember===m.id;card.ontoggle=()=>{if(card.open)adminOpenMember=m.id;else if(adminOpenMember===m.id)adminOpenMember=null;};const summary=document.createElement('summary');const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,m.name);const copy=document.createElement('div');copy.className='admin-member-copy';copy.append(textElement('strong',m.name),textElement('small',m.email));const badges=document.createElement('div');badges.className='admin-badges';for(const [label,kind] of [[ownOwner?'Owner':pendingTester(m)?'Access pending':'Tester approved',pendingTester(m)?'pending':''],[status==='pending'?'Host application':status==='review'?'Trial review':status==='trial'?'Trial host':status==='approved'?'Host':status==='rejected'?'Application rejected':'Viewer',['pending','review'].includes(status)?'pending':['trial','approved'].includes(status)?'host':'']]){const badge=textElement('span',label);badge.className='admin-badge '+kind;badges.append(badge);}if(isTestAccount(m)){const badge=textElement('span','Test account');badge.className='admin-badge test';badges.append(badge);}const chevron=textElement('span','›');chevron.className='admin-member-chevron';chevron.setAttribute('aria-hidden','true');summary.append(avatar,copy,badges,chevron);const body=document.createElement('div');body.className='admin-member-body';const identity=detailGroup('Account details');identity.append(textElement('p','Country: '+(config.countries?.find(c=>c.code===m.country)?.name || m.country || 'Profile not completed')),textElement('code',m.id));body.append(identity);
 if(managementData.permissions.includes('profiles') && adminView==='accounts'){const group=detailGroup('Public profile');group.append(textElement('p',m.profile_removed?'Removed from public view':m.profile_locked?'Editing locked':'Visible · editing allowed'),actionButton('Edit profile',()=>editAdminProfile(m.id)));if(!ownOwner)group.append(actionButton(m.profile_locked?'Unlock editing':'Lock editing',()=>changeAdminProfile(m.id,m.profile_locked?'unlock':'lock')),actionButton(m.profile_removed?'Restore profile':'Remove profile',()=>changeAdminProfile(m.id,m.profile_removed?'restore':'remove')));body.append(group);}
 if(m.application){let application;try{application=JSON.parse(m.application);}catch{application={};}const group=detailGroup('Host application');const dl=document.createElement('dl');dl.className='admin-application-grid';for(const [key,label] of [['bio','Bio'],['languages','Languages'],['experience','Experience'],['socialLinks','Social links'],['contact','Contact'],['submittedAt','Submitted']])if(application[key])dl.append(textElement('dt',label),textElement('dd',application[key]));if(!dl.children.length)group.append(textElement('p','No extra details supplied.'));else group.append(dl);body.append(group);}
 if(ownOwner){body.append(textElement('p','Your owner access includes all administrator permissions.'));}
 else{
 if(managementData.permissions.includes('testers') && ['accounts','overview'].includes(adminView)){const group=detailGroup('Tester access');group.append(actionButton(m.tester?'Remove tester access':'Approve tester access',()=>adminAction({action:'tester',userId:m.id,approved:!m.tester})));body.append(group);}
 if(managementData.permissions.includes('hosts') && adminView!=='team'){const group=detailGroup('Hosting');if(m.trial_end)group.append(textElement('p','Trial ends '+new Date(m.trial_end).toLocaleString()));if(m.hostActivity){const a=m.hostActivity,r=a.requirements;group.append(textElement('p',`Current week: ${a.qualifyingHours} qualifying hours (${a.weekHours} actual) · ${a.weekDays} live days. All time: ${a.totalHours} hours.`),textElement('p',`Weekly targets: ${r.hours||'not set'} hours · ${r.days||'not set'} days${r.dailyCap?' · '+r.dailyCap+' hour daily cap':''}. Review the audition and activity before deciding.`));}const row=document.createElement('div');row.className='row';const select=document.createElement('select');for(const [v,label] of [['trial','Start / extend trial'],['approved','Approve continued hosting'],['viewer','Remove host access'],['rejected','Reject application']]){const option=textElement('option',label);option.value=v;option.disabled=v==='approved'&&!['trial','approved','review'].includes(status);select.append(option);}select.value=['trial','review','approved'].includes(status)?'approved':'trial';const days=document.createElement('input');days.type='number';days.min=1;days.max=365;days.value=managementData.settings?.trialDays || '';days.placeholder='Programme default';const daysWrap=labelledAdminInput('Trial days for '+m.name,days);daysWrap.hidden=select.value!=='trial';select.onchange=()=>daysWrap.hidden=select.value!=='trial';row.append(labelledAdminInput('Host decision for '+m.name,select),daysWrap);group.append(row,actionButton('Save host decision',()=>adminAction({action:'host',userId:m.id,status:select.value,days:days.value?Number(days.value):undefined})));body.append(group);}
 if(managementData.permissions.includes('moderation') && adminView==='accounts'){const group=detailGroup('Suspension');group.append(textElement('p',`Last IP: ${m.last_ip || 'Unavailable'} · Phone: ${m.phone || 'Not supplied'} (unverified)`));const row=document.createElement('div');row.className='row';const kind=document.createElement('select');for(const x of ['account','phone','ip']){const option=textElement('option',x==='account'?'Account':x==='phone'?'Phone + account':'IP + account');option.value=x;kind.append(option);}const days=document.createElement('input');days.type='number';days.min=0;days.max=365;days.value=0;const reason=document.createElement('input');reason.maxLength=500;reason.placeholder='Explain the suspension';row.append(labelledAdminInput('Suspension type',kind),labelledAdminInput('Days (0 = permanent)',days));group.append(row,labelledAdminInput('Suspension reason',reason));const suspend=actionButton('Suspend account',()=>adminAction({action:'block',userId:m.id,kind:kind.value,days:Number(days.value),reason:reason.value}));suspend.classList.add('danger');group.append(suspend);body.append(group);}
 if(managementData.owner && ['accounts','team'].includes(adminView)){const group=detailGroup('Admin permissions');if(adminView==='team')group.open=true;const box=document.createElement('div');box.className='admin-permissions';for(const [permission,labelText] of [['testers','Approve tester access'],['hosts','Review hosts and trials'],['moderation','Manage reports and suspensions'],['settings','Change programme settings'],['appeals','Reply to appeals'],['profiles','Edit, lock and remove profiles'],['progression','Manage levels, badges and rankings'],['gifts','Set gift availability and test prices']]){const label=document.createElement('label');label.className='permission-check';const input=document.createElement('input');input.type='checkbox';input.value=permission;input.checked=m.permissions?.includes(permission);label.append(input,document.createTextNode(labelText));box.append(label);}group.append(box,actionButton('Save admin permissions',()=>adminAction({action:'permissions',userId:m.id,permissions:[...box.querySelectorAll('input:checked')].map(x=>x.value)})));body.append(group);}
 }
 card.append(summary,body);$('members').append(card);
 }
}
function renderAdminOverview(){const target=$('adminOverview');target.replaceChildren();const stats=document.createElement('div');stats.className='admin-stats';const items=[['Tester requests',adminMembers().filter(pendingTester).length,'accounts','testers'],['Host applications',adminMembers().filter(m=>memberStatus(m)==='pending').length,'applications','hosts'],['Trial reviews',adminMembers().filter(m=>memberStatus(m)==='review').length,'trials','hosts'],['Open appeals',adminAppeals().filter(a=>a.status==='open').length,'appeals','appeals']];for(const [label,count,view,permission] of items){if(!managementData.permissions.includes(permission))continue;const card=actionButton('',()=>setAdminView(view,permission==='testers'?'pending':'all'));card.className='admin-stat';card.append(textElement('span',label),textElement('strong',String(count)),textElement('small','Review →'));stats.append(card);}target.append(stats,textElement('p',$('adminShowTestAccounts').checked && managementData.owner ? 'Test accounts are included. Turn off Show test accounts to return to real requests.' : 'Showing recent accounts. Open a request below to review its details.'));target.lastChild.className='admin-overview-note';}
let adminGiftCategory='Veya';
function previewAdminGift(gift){
 const dialog=$('giftPreviewDialog'),stage=$('giftPreviewStage');stage.replaceChildren();
 if(gift.flag){stage.dataset.flag=gift.flag;delete stage.dataset.atlas;const image=document.createElement('img');image.className='scene-flag';image.src=flagArt(gift.flag);image.alt='';stage.append(image);}
 else if(gift.scene){delete stage.dataset.flag;if(gift.atlas)stage.dataset.atlas=gift.atlas;else delete stage.dataset.atlas;stage.dataset.scene=gift.scene;const art=document.createElement('div');art.className='scene-art';stage.append(art);}
 else{delete stage.dataset.flag;delete stage.dataset.atlas;const art=giftVisual(gift);art.classList.add('gift-preview-classic');stage.append(art);}
 for(let i=0;i<6;i++){const spark=document.createElement('i');spark.className='scene-spark';stage.append(spark);}
 $('giftPreviewTitle').textContent=gift.name;$('giftPreviewSound').onclick=()=>playGiftSound({giftId:gift.id,flag:gift.flag,atlas:gift.atlas,points:gift.points},true);
 dialog.showModal();playGiftSound({giftId:gift.id,flag:gift.flag,atlas:gift.atlas,points:gift.points},true);
}
async function loadAdminGifts(){
 const target=$('adminGifts');target.replaceChildren();
 if(managementData.permissions.includes('gifts')){
  const {gifts,audit}=await api('/api/admin/gift-catalog');
  target.append(textElement('h2','Gift studio'),textElement('p','Choose which gifts appear and set their test credit price. Changes apply to future sends; gift history keeps the price paid at the time. No real payments are active.'));
  const tabs=document.createElement('div');tabs.className='admin-gift-tabs';
  for(const category of ['Veya','Flags','Classic']){const button=textElement('button',`${category} (${gifts.filter(g=>g.category===category).length})`);button.type='button';button.setAttribute('aria-pressed',String(adminGiftCategory===category));button.onclick=()=>{adminGiftCategory=category;void loadAdminGifts();};tabs.append(button);}
  target.append(tabs);
  for(const gift of gifts.filter(g=>g.category===adminGiftCategory)){
   const row=document.createElement('div');row.className='admin-gift-tools';const art=actionButton('',()=>previewAdminGift(gift));art.className='admin-gift-preview';art.setAttribute('aria-label',`Preview ${gift.name}`);art.append(giftVisual(gift));
   const description=document.createElement('div');description.append(textElement('strong',gift.name),textElement('small',gift.flag?'Flag gift':gift.scene?'Illustrated gift':'Classic animated gift'));
   const price=document.createElement('input');price.type='number';price.min='1';price.max='250';price.step='1';price.value=gift.points;price.setAttribute('aria-label',`${gift.name} test credit price`);
   const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=gift.enabled;enabled.setAttribute('aria-label',`Allow ${gift.name}`);const toggle=document.createElement('label');toggle.append(enabled,document.createTextNode('Allow'));
   const save=actionButton('Save',async()=>{save.disabled=true;try{const points=Number(price.value);await api('/api/admin/gift-catalog',{giftId:gift.id,points,enabled:enabled.checked});gift.points=points;gift.enabled=enabled.checked;$('adminSaveStatus').textContent=`Saved ${gift.name}`;}catch(e){$('adminSaveStatus').textContent=e.message;}finally{save.disabled=false;}});
   row.append(art,description,price,toggle,save);target.append(row);
  }
  if(audit.length){const group=document.createElement('details');group.className='admin-gift-separator';group.append(textElement('summary','Recent gift changes'));for(const a of audit.slice(0,20))group.append(textElement('p',`${new Date(a.changedAt).toLocaleString()} · ${a.giftId} · ${a.enabled?'Allowed':'Hidden'} · ${a.points} credits`));target.append(group);}
 }
 if(managementData.permissions.some(p=>['moderation','gifts'].includes(p))){
  const result=await api('/api/admin/test-gifts');const history=document.createElement('details');history.className='admin-gift-separator';history.append(textElement('summary',`Gift send history (${result.transfers.length})`));
  if(!result.transfers.length)history.append(textElement('p','No gifts sent yet.'));
  for(const gift of result.transfers){const row=document.createElement('div');row.className='admin-gift-row';row.append(textElement('strong',`${gift.senderName} → ${gift.recipientName}: ${gift.gift} (${gift.points} credits)`),textElement('small',`${new Date(gift.createdAt).toLocaleString()} · Room ${gift.roomId} · ${gift.id}`));history.append(row);}target.append(history);
 }
}
async function setAdminView(view,filter='all'){if(adminView!==view){$('memberSearch').value='';$('memberFilter').value=filter;adminOpenMember=null;}adminView=view;const visible={overview:true,accounts:managementData.permissions.some(p=>['testers','hosts','moderation','profiles'].includes(p)),applications:managementData.permissions.includes('hosts'),trials:managementData.permissions.includes('hosts'),reports:managementData.permissions.includes('moderation'),gifts:managementData.permissions.some(p=>['moderation','gifts'].includes(p)),progression:managementData.permissions.includes('progression'),appeals:managementData.permissions.includes('appeals'),blocks:managementData.permissions.includes('moderation'),team:managementData.owner,settings:managementData.permissions.includes('settings')};if(!visible[view])adminView='overview';$('adminSectionSelect').replaceChildren();for(const button of $('adminTabs').querySelectorAll('button')){button.hidden=!visible[button.dataset.adminView];if(!button.hidden){const option=textElement('option',button.textContent);option.value=button.dataset.adminView;$('adminSectionSelect').append(option);}if(button.dataset.adminView===adminView)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}$('adminSectionSelect').value=adminView;const membersView=['overview','accounts','applications','trials','team'].includes(adminView);$('management').hidden=['reports','gifts','progression'].includes(adminView);$('adminProgression').hidden=adminView!=='progression';$('reports').hidden=adminView!=='reports';$('adminGifts').hidden=adminView!=='gifts';$('adminOverview').hidden=adminView!=='overview';$('adminAccountSection').hidden=!membersView;$('trialSettings').hidden=adminView!=='settings';$('blocks').hidden=adminView!=='blocks';$('adminAppeals').hidden=adminView!=='appeals';$('adminAudit').hidden=adminView!=='team';$('memberFilter').hidden=adminView!=='accounts';$('memberFilter').querySelector('option[value=admins]').hidden=!managementData.owner;if(!managementData.owner && $('memberFilter').value==='admins')$('memberFilter').value='all';$('adminTestAccountsLabel').hidden=!managementData.owner;$('adminMemberHeading').textContent={overview:'Needs attention',accounts:'Accounts',applications:'Host applications',trials:'Trials and reviews',team:'Administrators'}[adminView] || '';if(membersView)renderMembers();if(adminView==='reports'){try{await loadReports();}catch(e){notice(e.message);}}if(adminView==='gifts'){try{await loadAdminGifts();}catch(e){notice(e.message);}}if(adminView==='progression'){try{await loadAdminProgression();}catch(e){notice(e.message);}}}
async function loadManagement(){
 managementData=await api('/api/admin/management');renderAdminOverview();$('trialSettings').replaceChildren();
 if(managementData.settings){const s=managementData.settings;const form=document.createElement('form');form.className='card';form.append(textElement('h2','Trial and access settings'),textElement('p','Trial length changes apply to new or extended trials. The outcome rule applies when a trial expires. Weekly targets reset Monday at 00:00 UTC. Payment values are planning settings; purchases and payouts are not active.'));const grid=document.createElement('div');grid.className='settings-grid';const inputs={};for(const [field,label] of [['trialDays','Trial length (days)'],['minimumHours','Weekly target live hours (0 = unset)'],['minimumDays','Weekly target live days (0 = unset)'],['dailyHourCap','Qualifying hours per UTC day (0 = no cap)'],['trialAmount','Planned trial payment amount']]){const wrap=document.createElement('div');const labelNode=textElement('label',label);const input=document.createElement('input');input.type='number';input.min=field==='trialDays'?1:0;input.step=field==='trialDays'||field==='minimumDays'?1:.25;input.value=s[field];input.setAttribute('aria-label',label);inputs[field]=input;wrap.append(labelNode,input);grid.append(wrap);}form.append(grid);
 for(const [field,label] of [['testingApproval','Require admin approval for tester access'],['paidTrial','Mark trials as part of the planned paid programme']]){const wrap=document.createElement('label');wrap.className='check';const input=document.createElement('input');input.type='checkbox';input.checked=s[field];inputs[field]=input;wrap.append(input,document.createTextNode(label));form.append(wrap);}
 const outcome=document.createElement('select');outcome.setAttribute('aria-label','After trial expires');for(const [value,label] of [['review','Pause hosting until reviewed'],['continue','Automatically approve continued hosting']]){const option=textElement('option',label);option.value=value;outcome.append(option);}outcome.value=s.trialOutcome;form.append(textElement('label','After trial expires'),outcome);const submit=textElement('button','Save settings');submit.className='btn wide';form.append(submit);form.onsubmit=e=>{e.preventDefault();const input={action:'settings',trialOutcome:outcome.value};for(const [key,el] of Object.entries(inputs))input[key]=el.type==='checkbox'?el.checked:Number(el.value);void adminAction(input);};$('trialSettings').append(form);}
 $('blocks').replaceChildren();if(!managementData.blocks.length){const empty=textElement('p','No active suspensions.');empty.className='admin-empty';$('blocks').append(empty);}if(managementData.blocks.length)$('blocks').append(textElement('h2','Active suspensions'));for(const b of managementData.blocks){const card=document.createElement('div');card.className='report-item';card.append(textElement('p',`${b.kind}: ${b.value} · ${b.reason} · ${b.expires_at?new Date(b.expires_at).toLocaleString():'Permanent'}`),actionButton('Lift suspension',()=>adminAction({action:'unblock',blockId:b.id})));$('blocks').append(card);}
 $('adminAppeals').replaceChildren();if(!adminAppeals().length){const empty=textElement('p','No appeals to review.');empty.className='admin-empty';$('adminAppeals').append(empty);}if(adminAppeals().length)$('adminAppeals').append(textElement('h2','Appeals'));for(const a of adminAppeals()){const card=document.createElement('div');card.className='report-item';const response=document.createElement('textarea');response.value=a.response;response.maxLength=1000;response.setAttribute('aria-label','Reply to appeal');card.append(textElement('h2',a.name),textElement('p',`${a.status}: ${a.message}`),response,actionButton('Reply and mark reviewed',()=>adminAction({action:'appeal',appealId:a.id,status:'reviewed',response:response.value})));$('adminAppeals').append(card);}
 $('adminAudit').replaceChildren();if(managementData.owner){const group=document.createElement('details');group.className='card';group.append(textElement('summary','Recent admin activity'));for(const entry of managementData.audit || []){const row=textElement('p',`${new Date(entry.created_at).toLocaleString()} · ${entry.action} · ${entry.target || ''}`);row.className='admin-audit-row';group.append(row);}$('adminAudit').append(group);}
 await setAdminView(adminView);
}
$('adminShowTestAccounts').onchange=()=>loadManagement().catch(e=>notice(e.message));$('adminSectionSelect').onchange=()=>setAdminView($('adminSectionSelect').value);$('memberSearch').oninput=()=>{if(managementData)renderMembers();};$('memberFilter').onchange=()=>{if(managementData)renderMembers();};for(const button of $('adminTabs').querySelectorAll('button'))button.onclick=()=>setAdminView(button.dataset.adminView);

function openConnections(id,kind){connectionId=id;connectionKind=kind;navigate('following');}
async function loadConnections(more=false){if(!currentUser?.access?.accessAllowed)return;const id=connectionId || currentUser.id,kind=connectionKind,version=more?connectionVersion:++connectionVersion,offset=more?connectionNext:0;if(more && offset===null)return;for(const [tab,tabKind] of [['connectionsFollowing','following'],['connectionsFollowers','followers']]){if(kind===tabKind)$(tab).setAttribute('aria-current','page');else $(tab).removeAttribute('aria-current');}$('connectionsMore').disabled=true;try{const result=await api('/api/connections?id='+encodeURIComponent(id)+'&kind='+kind+'&offset='+offset);if(version!==connectionVersion || id!==(connectionId || currentUser.id) || kind!==connectionKind)return;followingPeople=more?[...followingPeople,...result.people]:result.people;connectionNext=result.nextOffset;$('connectionsOwner').textContent=id===currentUser.id?'Your people':result.profile.displayName;$('connectionsMore').hidden=connectionNext===null;renderPeople(true);}catch(e){if(version===connectionVersion)$('followedHosts').textContent=e.message;}finally{$('connectionsMore').disabled=false;}}
$('connectionsMore').onclick=()=>loadConnections(true);
$('connectionsFollowing').onclick=()=>openConnections(connectionId || currentUser.id,'following');$('connectionsFollowers').onclick=()=>openConnections(connectionId || currentUser.id,'followers');$('connectionsBack').onclick=()=>connectionId && connectionId!==currentUser.id?openPublicProfile(connectionId):navigate('profile');
$('navFollowing').onclick=()=>openConnections(currentUser.id,'following');$('navUpdates').onclick=()=>navigate('updates');
$('closePublicProfile').onclick=()=>navigate(publicProfileId===currentUser.id?'profile':'discover');
$('shareProfile').onclick=async()=>{const url=location.origin+'/profile/'+publicProfileId;try{if(navigator.share){await navigator.share({title:$('publicName').textContent+' on Veya',url});return;}await navigator.clipboard.writeText(url);notice('Profile link copied.');}catch(e){if(e.name==='AbortError')return;try{await navigator.clipboard.writeText(url);notice('Profile link copied.');}catch{notice('Your profile link: '+url);}}};
async function openPublicProfile(id){try{const {profile:p}=await api('/api/public-profile?id='+encodeURIComponent(id));paintProfileDetails('public',p);paintAvatar($('publicAvatar'),p.displayName,p.avatar);$('publicName').textContent=p.displayName;$('publicBio').textContent=p.bio || '';$('publicAboutSection').hidden=!p.bio;$('publicHobbiesSection').hidden=!p.hobbies?.length;$('publicInfoEmpty').hidden=Boolean(p.bio || p.hobbies?.length);$('momentForm').hidden=p.id!==currentUser.id || currentUser.profileLocked || currentUser.profileRemoved;$('publicCountry').textContent=config.countries?.find(c=>c.code===p.country)?.name || p.country;$('publicRole').textContent=p.isHost?'Host':'Viewer';$('publicFollowers').textContent=p.followers;$('publicFollowing').textContent=p.following;$('followHost').hidden=p.id===currentUser.id;$('messageProfile').hidden=p.id===currentUser.id;const canCall=p.id!==currentUser.id && p.isHost && directoryPeople.some(x=>x.id===p.id && x.callStatus==='available');$('callProfile').hidden=!canCall;$('callProfile').onclick=()=>requestCall(p.id);$('followHost').textContent=p.isFollowing?'Unfollow':'Follow';$('followHost').onclick=async()=>{try{await api('/api/follow',{userId:p.id,enabled:!p.isFollowing});await openPublicProfile(p.id);void loadPeople(false);if(!$('following').hidden)void loadConnections();}catch(e){notice(e.message);}};const {rooms}=await api('/api/rooms');const live=rooms.find(r=>r.hostId===p.id);$('publicPresence').textContent=live?'Live now':p.isHost?'Not live right now':'Veya member';$('publicPresence').dataset.live=String(Boolean(live));$('joinProfileLive').hidden=!live;$('joinProfileLive').onclick=()=>{navigate('discover');requestJoin(live.id);};publicProfileId=p.id;void loadPublicProgression(p.id);$('publicProfileDialog').dataset.theme=p.theme || 'violet';paintCover($('publicCover'),p.banner);selectProfileTab('information');navigate('publicProfileDialog');if(location.pathname!=='/profile/'+p.id)history.pushState(null,'','/profile/'+p.id);}catch(e){notice(e.message);}}
let momentPhoto='';
function selectProfileTab(tab){const info=tab==='information';$('publicInfoTab').setAttribute('aria-selected',String(info));$('publicMomentsTab').setAttribute('aria-selected',String(!info));$('publicInfoPanel').hidden=!info;$('publicMomentsPanel').hidden=info;if(!info)void loadMoments();}
$('publicInfoTab').onclick=()=>selectProfileTab('information');$('publicMomentsTab').onclick=()=>selectProfileTab('moments');
async function loadMoments(){const id=publicProfileId;const target=$('momentList');target.textContent='Loading Moments…';try{const {moments:items}=await api('/api/moments?id='+encodeURIComponent(id));if(publicProfileId!==id)return;target.replaceChildren();if(!items.length){const empty=textElement('p',id===currentUser.id?'Your Moments will appear here. Share a photo or a thought.':'No Moments shared yet.');empty.className='profile-empty';target.append(empty);return;}for(const m of items){const card=document.createElement('article');card.className='moment-card';const date=textElement('time',new Date(m.createdAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));date.dateTime=new Date(m.createdAt).toISOString();card.append(date);if(m.caption){const copy=textElement('p',m.caption);copy.className='moment-caption';card.append(copy);}if(m.image){const photo=document.createElement('img');photo.src=m.image;photo.alt='Moment photo';photo.loading='lazy';card.append(photo);}const actions=document.createElement('div');actions.className='moment-actions';const like=textElement('button',(m.liked?'♥':'♡')+' '+m.likes);like.type='button';like.setAttribute('aria-label',(m.liked?'Unlike':'Like')+' Moment');like.setAttribute('aria-pressed',String(m.liked));like.onclick=async()=>{like.disabled=true;try{const result=await api('/api/moments/like',{id:m.id,enabled:!m.liked});m.liked=result.liked;m.likes=result.likes;like.textContent=(m.liked?'♥':'♡')+' '+m.likes;like.setAttribute('aria-label',(m.liked?'Unlike':'Like')+' Moment');like.setAttribute('aria-pressed',String(m.liked));}catch(e){$('momentError').textContent=e.message;}finally{like.disabled=false;}};actions.append(like);const replies=textElement('button','Replies '+m.comments);replies.type='button';replies.setAttribute('aria-expanded','false');replies.onclick=()=>{void openMomentReplies(m,card,replies);};actions.append(replies);if(id===currentUser.id || currentUser.access?.permissions?.includes('profiles')){const remove=textElement('button','Remove');remove.type='button';remove.onclick=async()=>{if(!confirm('Remove this Moment?'))return;remove.disabled=true;try{await api('/api/moments/remove',{id:m.id});await loadMoments();}catch(e){$('momentError').textContent=e.message;remove.disabled=false;}};actions.append(remove);}card.append(actions);target.append(card);}}catch(e){target.textContent=e.message;}}
async function openMomentReplies(moment,card,button){
 let panel=card.querySelector('.moment-replies');if(panel){panel.remove();button.setAttribute('aria-expanded','false');return;}
 panel=document.createElement('section');panel.className='moment-replies';panel.setAttribute('aria-label','Replies');panel.append(textElement('p','Loading replies…'));card.append(panel);button.setAttribute('aria-expanded','true');
 async function render(){const {comments}=await api('/api/moments/comments?id='+encodeURIComponent(moment.id));if(!panel.isConnected)return;const list=document.createElement('div');list.className='moment-reply-list';if(!comments.length)list.append(textElement('p','No replies yet.'));for(const comment of comments){const row=document.createElement('div');row.className='moment-reply';const copy=document.createElement('div');copy.append(textElement('strong',comment.name),textElement('p',comment.body));row.append(copy);if(comment.userId===currentUser.id || publicProfileId===currentUser.id || currentUser.access?.permissions?.includes('profiles')){const remove=textElement('button','Remove');remove.type='button';remove.className='text-button';remove.setAttribute('aria-label','Remove reply by '+comment.name);remove.onclick=async()=>{if(!confirm('Remove this reply?'))return;remove.disabled=true;try{await api('/api/moments/comment/remove',{id:comment.id});moment.comments=Math.max(0,moment.comments-1);button.textContent='Replies '+moment.comments;await render();}catch(e){notice(e.message);remove.disabled=false;}};row.append(remove);}list.append(row);}const form=document.createElement('form');form.className='moment-reply-form';const input=document.createElement('input');input.maxLength=300;input.placeholder='Write a reply…';input.setAttribute('aria-label','Write a reply');input.required=true;const send=textElement('button','Post');send.type='submit';send.className='btn';form.append(input,send);form.onsubmit=async event=>{event.preventDefault();send.disabled=true;try{await api('/api/moments/comment',{id:moment.id,body:input.value});moment.comments++;button.textContent='Replies '+moment.comments;await render();}catch(e){notice(e.message);send.disabled=false;}};panel.replaceChildren(list,form);}
 try{await render();}catch(e){panel.replaceChildren(textElement('p',e.message));}
}
$('momentFile').onchange=async()=>{const file=$('momentFile').files[0];if(!file)return;let image;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP under 5 MB.');image=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,840/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);momentPhoto=canvas.toDataURL('image/jpeg',.72);for(let n=0;momentPhoto.length>150000 && n<5;n++){const next=document.createElement('canvas');next.width=Math.max(1,Math.round(canvas.width*.8));next.height=Math.max(1,Math.round(canvas.height*.8));next.getContext('2d').drawImage(canvas,0,0,next.width,next.height);canvas.width=next.width;canvas.height=next.height;canvas.getContext('2d').drawImage(next,0,0);momentPhoto=canvas.toDataURL('image/jpeg',.66);}if(momentPhoto.length>150000)throw Error('This photo is too detailed. Try a smaller one.');const preview=$('momentPhotoPreview');const photo=document.createElement('img');photo.src=momentPhoto;photo.alt='Selected photo';preview.replaceChildren(photo);preview.hidden=false;$('momentClearPhoto').hidden=false;$('momentError').textContent='';}catch(e){momentPhoto='';$('momentError').textContent=e.message;}finally{image?.close();$('momentFile').value='';}};
$('momentClearPhoto').onclick=()=>{momentPhoto='';$('momentPhotoPreview').replaceChildren();$('momentPhotoPreview').hidden=true;$('momentClearPhoto').hidden=true;};
$('momentForm').onsubmit=async event=>{event.preventDefault();$('momentSubmit').disabled=true;$('momentError').textContent='';try{await api('/api/moments/create',{caption:$('momentCaption').value,image:momentPhoto});$('momentCaption').value='';$('momentClearPhoto').click();await loadMoments();}catch(e){$('momentError').textContent=e.message;}finally{$('momentSubmit').disabled=false;}};
async function loadPeople(following){if(!currentUser?.access?.accessAllowed)return;const query=following?'':$('roomSearch').value.trim(),version=following?0:++peopleVersion;try{const {people}=await api('/api/people?'+(following?'following=1':'q='+encodeURIComponent(query)));if(!following && (version!==peopleVersion || query!==$('roomSearch').value.trim()))return;if(following)followingPeople=people;else directoryPeople=people;renderPeople(following);}catch(e){if(following || version===peopleVersion)$(following?'followedHosts':'hostDirectory').textContent=e.message;}}
function countryLabel(code){return config.countries?.find(c=>c.code===code)?.name || code || 'Veya';}
function countryPlace(code){const place=document.createElement('small');place.className='country-place';if(['SA','AE','KW','QA','EG','PS','IQ','LB'].includes(code)){const flag=document.createElement('img');flag.src=`/gifts/flags/${code.toLowerCase()}.svg`;flag.alt='';place.append(flag);}place.append(document.createTextNode(countryLabel(code)));return place;}
function selectExplore(view){exploreView=view;for(const name of ['live','hosts','people']){$(name==='live'?'liveExplore':name==='hosts'?'hostExplore':'peopleExplore').hidden=view!==name;const tab=$('exploreSwitch').querySelector(`[data-explore="${name}"]`);tab.setAttribute('aria-selected',String(view===name));}if(!$('discover').hidden)void loadPeople(false);}
for(const tab of $('exploreSwitch').querySelectorAll('button'))tab.onclick=()=>selectExplore(tab.dataset.explore);
function renderPeople(following){
 if(following){const target=$('followedHosts');const people=followingPeople;target.replaceChildren();if(!people.length){const empty=textElement('p',connectionKind==='followers'?'No followers yet.':'Not following anyone yet. Find people in Explore.');empty.className='directory-empty';target.append(empty);return;}for(const p of people)target.append(personRow(p,true));return;}
 const query=$('roomSearch').value.trim().toLowerCase();
 const matches=directoryPeople.filter(p=>p.id!==currentUser.id && `${p.displayName} ${p.bio} ${(p.hobbies||[]).join(' ')} ${countryLabel(p.country)}`.toLowerCase().includes(query));
 const hosts=matches.filter(p=>p.isHost),hostTarget=$('hostDirectory'),peopleTarget=$('viewerDirectory');hostTarget.replaceChildren();peopleTarget.replaceChildren();
 $('hostDirectoryCount').textContent=hosts.length?String(hosts.length):'';$('peopleDirectoryCount').textContent=matches.length?String(matches.length):'';
 if(!hosts.length){const empty=textElement('p',query?'No hosts match your search.':'Approved hosts will appear here.');empty.className='directory-empty';hostTarget.append(empty);}
 for(const p of hosts){const live=allRooms.find(r=>r.hostId===p.id);const card=document.createElement('article');card.className='discover-host-card';card.dataset.theme=p.theme||'violet';
  const top=document.createElement('button');top.type='button';top.className='host-portrait';top.setAttribute('aria-label',`View ${p.displayName}'s profile`);top.onclick=()=>openPublicProfile(p.id);
  const halo=document.createElement('div');halo.className='host-portrait-halo';const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,p.displayName,p.avatar);halo.append(avatar);const badge=textElement('span',live?'● LIVE':p.callStatus==='available'?'● AVAILABLE':'HOST');badge.className='host-status'+(live?' is-live':p.callStatus==='available'?' is-available':'');top.append(halo,badge);
  const info=document.createElement('div');info.className='host-info';const name=textElement('strong',p.displayName);info.append(name,countryPlace(p.country));if(live){const roomTitle=textElement('span',live.title);roomTitle.className='host-room-title';info.append(roomTitle);}card.append(top,info);
  const actions=document.createElement('div');actions.className='host-card-actions';actions.append(actionButton('Profile',()=>openPublicProfile(p.id)));if(live)actions.append(actionButton('Join live',()=>requestJoin(live.id)));else if(p.callStatus==='available')actions.append(actionButton('Call',()=>requestCall(p.id)));else actions.append(followAction(p,()=>renderPeople(false)));card.append(actions);hostTarget.append(card);
 }
 if(!matches.length){const empty=textElement('p',query?'No people match your search.':'People will appear here when their access is approved.');empty.className='directory-empty';peopleTarget.append(empty);}
 for(const p of matches)peopleTarget.append(personRow(p,false));
}
function followAction(p,after){const button=actionButton(p.isFollowing?'Following':'Follow',async()=>{button.disabled=true;try{const result=await api('/api/follow',{userId:p.id,enabled:!p.isFollowing});Object.assign(p,result.profile);after();}catch(e){notice(e.message);}finally{button.disabled=false;}});button.className='btn '+(p.isFollowing?'quiet':'secondary');button.setAttribute('aria-label',`${p.isFollowing?'Unfollow':'Follow'} ${p.displayName}`);return button;}
function personRow(p,following){const card=document.createElement('div');card.className='card person-card';const live=allRooms.find(r=>r.hostId===p.id),profileButton=document.createElement('button');profileButton.className='host-card-profile';profileButton.setAttribute('aria-label',`View ${p.displayName}'s profile`);profileButton.onclick=()=>openPublicProfile(p.id);const avatar=document.createElement('div');avatar.className='avatar'+(live?' host-live-avatar':'');paintAvatar(avatar,p.displayName,p.avatar);const copy=document.createElement('div');copy.className='host-card-copy';copy.append(textElement('strong',p.displayName),countryPlace(p.country));const detail=textElement('small',live?'Live now':p.isHost?'Host':p.hobbies?.slice(0,2).join(' · ') || 'View profile');if(live)detail.className='host-card-live';copy.append(detail);profileButton.append(avatar,copy);card.append(profileButton);card.append(followAction(p,()=>following?loadConnections():renderPeople(false)));return card;}
async function loadUpdates(render=false){if(!currentUser?.access?.accessAllowed)return;try{const result=await api('/api/notifications');notificationItems=result.items;activityUnread=result.unread;if(!render)return;$('updateList').replaceChildren();if(!result.items.length)$('updateList').append(textElement('p','Your host updates and access decisions will appear here.'));const {rooms}=await api('/api/rooms');for(const n of result.items){const card=document.createElement('div');card.className='card';card.append(textElement('strong',n.message),textElement('p',new Date(n.createdAt).toLocaleString()));if(!n.seen)card.append(textElement('span','Unread'));const live=rooms.find(r=>r.id===n.roomId);if(live)card.append(actionButton('Join live',()=>requestJoin(live.id)));if(n.kind==='reply')card.append(actionButton('View your Moments',async()=>{await openPublicProfile(currentUser.id);selectProfileTab('moments');}));else if(n.kind==='follow' && n.actorId)card.append(actionButton('View profile',()=>openPublicProfile(n.actorId)));else if(n.kind==='live')card.append(textElement('p','This live has ended.'));$('updateList').append(card);}}catch(e){notice(e.message);}}
$('markUpdatesRead').onclick=async()=>{try{await api('/api/notifications/read',{ids:notificationItems.map(n=>n.id)});await loadUpdates(true);}catch(e){notice(e.message);}};
function selectInbox(section){inboxSection=section;const messages=section==='messages';$('conversationList').hidden=!messages;$('updateList').hidden=messages;$('markUpdatesRead').hidden=messages;$('messageTab').setAttribute('aria-selected',String(messages));$('activityTab').setAttribute('aria-selected',String(!messages));}
$('messageTab').onclick=()=>{selectInbox('messages');void loadConversations();};
$('activityTab').onclick=()=>{selectInbox('updates');void loadUpdates(true);};
async function loadConversations(){if(!currentUser?.access?.accessAllowed)return;try{const {conversations:items}=await api('/api/conversations');const target=$('conversationList');target.replaceChildren();const unread=activityUnread+items.reduce((n,c)=>n+c.unread,0);$('navUpdatesLabel').textContent='Inbox';$('navUpdates').setAttribute('aria-label',unread?`Inbox, ${unread} unread messages`:'Inbox');let dot=$('navUpdates').querySelector('.nav-unread');if(unread&&!dot){dot=document.createElement('span');dot.className='nav-unread';dot.setAttribute('aria-hidden','true');$('navUpdates').append(dot);}if(!unread)dot?.remove();if(!items.length){const empty=textElement('p','No messages yet. Open someone’s profile and tap Message to say hello.');empty.className='inbox-empty';target.append(empty);}for(const entry of items){const row=document.createElement('button');row.type='button';row.className='conversation-row';const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,entry.profile.displayName,entry.profile.avatar);const copy=document.createElement('div');copy.append(textElement('strong',entry.profile.displayName),textElement('span',`${entry.last.senderId===currentUser.id?'You: ':''}${entry.last.body}`));const meta=document.createElement('div');meta.className='conversation-meta';meta.append(textElement('time',new Date(entry.last.createdAt).toLocaleDateString()));if(entry.unread)meta.append(textElement('b',String(entry.unread)));row.append(avatar,copy,meta);row.onclick=()=>openMessageThread(entry.profile.id);target.append(row);}}catch(e){$('conversationList').textContent=e.message;}}
async function openMessageThread(id){activeMessagePeer=id;try{await loadMessageThread();navigate('messageThread');$('messageText').focus({preventScroll:true});}catch(e){notice(e.message);}}
async function loadMessageThread(){const id=activeMessagePeer;if(!id)return;const data=await api('/api/messages?userId='+encodeURIComponent(id));if(id!==activeMessagePeer)return;$('messagePeerName').textContent=data.profile.displayName;paintAvatar($('messagePeerAvatar'),data.profile.displayName,data.profile.avatar);const target=$('messageList');target.replaceChildren();if(!data.items.length){const empty=textElement('p','Start a conversation with '+data.profile.displayName+'.');empty.className='inbox-empty';target.append(empty);}for(const item of data.items){const row=document.createElement('div');row.className='message-bubble'+(item.senderId===currentUser.id?' mine':'');row.append(textElement('p',item.body),textElement('time',new Date(item.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})));target.append(row);}target.scrollTop=target.scrollHeight;$('messageBlock').textContent=data.blockedByMe?'Unblock messages':'Block messages';$('messageForm').hidden=data.blocked;$('messageError').textContent=data.blocked?'Messages are blocked in this conversation.':'';}
$('messageBack').onclick=()=>{activeMessagePeer=null;$('messageOptions').hidden=true;selectInbox('messages');navigate('updates');};
$('messageProfile').onclick=()=>openMessageThread(publicProfileId);
$('messageMenu').onclick=()=>{$('messageOptions').hidden=!$('messageOptions').hidden;};
$('messageForm').onsubmit=async e=>{e.preventDefault();const id=activeMessagePeer,body=$('messageText').value,sendButton=$('messageForm').querySelector('button');sendButton.disabled=true;$('messageError').textContent='';try{await api('/api/messages/send',{userId:id,body});$('messageText').value='';await loadMessageThread();}catch(error){$('messageError').textContent=error.message;}finally{sendButton.disabled=false;}};
$('messageRemove').onclick=async()=>{if(!confirm('Remove this conversation from your inbox? New messages will bring it back.'))return;try{await api('/api/messages/remove',{userId:activeMessagePeer});$('messageBack').click();notice('Conversation removed from your inbox.');}catch(e){$('messageError').textContent=e.message;}};
$('messageBlock').onclick=async()=>{const enabled=$('messageBlock').textContent==='Block messages';if(!confirm(enabled?'Block messages from this person?':'Allow messages from this person again?'))return;try{await api('/api/messages/block',{userId:activeMessagePeer,enabled});$('messageOptions').hidden=true;await loadMessageThread();}catch(e){$('messageError').textContent=e.message;}};
function paintCallAvailability(){const button=$('hostCallToggle');button.textContent=callOptIn?'Go offline':'Become available';button.className='btn '+(callOptIn?'quiet':'secondary');$('hostCallStatus').textContent=callOptIn?'Available while this app is open. Viewers can request a test call.':'You are offline for calls.';}
$('hostCallToggle').onclick=async()=>{const button=$('hostCallToggle');button.disabled=true;try{const result=await api('/api/calls/presence',{available:!callOptIn});callOptIn=result.available;paintCallAvailability();}catch(e){$('hostCallStatus').textContent=e.message;}finally{button.disabled=false;}};
function resetCall(){const room=callRoom;callRoom=null;void room?.disconnect();for(const track of callTracks){track.detach();track.stop();}callTracks=[];$('callLocalVideo').srcObject=null;$('callRemoteVideo').srcObject=null;$('callRemoteAudio').srcObject=null;callConnecting=false;currentCall=null;}
function paintCall(call){currentCall=call;paintAvatar($('callPartnerAvatar'),call.partner.displayName,call.partner.avatar);$('callHeading').textContent=call.partner.displayName;$('callError').textContent='';const ringing=call.status==='ringing';$('callStateText').textContent=ringing?(call.role==='host'?'Incoming video call':'Calling… waiting for the host'):callRoom?'Connected':'Ready for your camera and microphone';$('callAccept').hidden=!ringing||call.role!=='host';$('callDecline').hidden=!ringing||call.role!=='host';$('callConnect').hidden=ringing||Boolean(callRoom);$('callMic').hidden=!callRoom;$('callCamera').hidden=!callRoom;$('callHangup').textContent=ringing?'Cancel':'End call';if($('callScreen').hidden)navigate('callScreen');}
async function pollCall(){if(!currentUser?.access?.accessAllowed||!currentUser.onboarded||activeRoom)return;try{const {call}=await api('/api/calls/state');if(call){if(!currentCall||currentCall.id!==call.id||currentCall.status!==call.status)paintCall(call);else currentCall=call;}else if(currentCall){resetCall();navigate('discover');notice('The call ended.');}}catch(e){if(currentCall)$('callError').textContent=e.message;}}
async function requestCall(hostId){if(currentCall||activeRoom)return;try{const result=await api('/api/calls/invite',{hostId});if(result.call)paintCall(result.call);}catch(e){notice(e.message);}}
$('callAccept').onclick=async()=>{try{const {call}=await api('/api/calls/respond',{id:currentCall.id,accept:true});paintCall(call);}catch(e){$('callError').textContent=e.message;}};
$('callDecline').onclick=async()=>{try{await api('/api/calls/respond',{id:currentCall.id,accept:false});resetCall();navigate('discover');}catch(e){$('callError').textContent=e.message;}};
$('callHangup').onclick=async()=>{const id=currentCall?.id;if(!id)return;$('callHangup').disabled=true;try{await api('/api/calls/end',{id});}catch(e){$('callError').textContent=e.message;}finally{resetCall();$('callHangup').disabled=false;navigate('discover');}};
$('callConnect').onclick=async()=>{if(!currentCall||currentCall.status!=='active'||callRoom||callConnecting)return;callConnecting=true;$('callConnect').disabled=true;$('callError').textContent='';try{
 const {call}=await api('/api/calls/state');if(!call?.media)throw Error('The call has ended');const tracks=await createLocalTracks({audio:true,video:true});callTracks=tracks;
 const room=new Room();callRoom=room;room.on(RoomEvent.TrackSubscribed,(track)=>{if(track.kind===Track.Kind.Video)track.attach($('callRemoteVideo'));else if(track.kind===Track.Kind.Audio)track.attach($('callRemoteAudio'));});
 room.on(RoomEvent.TrackUnsubscribed,track=>track.detach());room.on(RoomEvent.Disconnected,()=>{if(currentCall)void pollCall();});
 await room.connect(call.media.url,call.media.token);for(const track of tracks)await room.localParticipant.publishTrack(track);tracks.find(t=>t.kind===Track.Kind.Video)?.attach($('callLocalVideo'));$('callConnect').hidden=true;$('callMic').hidden=false;$('callCamera').hidden=false;$('callStateText').textContent='Connected';
 }catch(e){$('callError').textContent=e.name==='NotAllowedError'?'Allow camera and microphone access to connect.':e.message;const room=callRoom;callRoom=null;void room?.disconnect();for(const track of callTracks)track.stop();callTracks=[];}finally{$('callConnect').disabled=false;callConnecting=false;}};
$('callMic').onclick=async()=>{const track=callTracks.find(t=>t.kind===Track.Kind.Audio);if(!track)return;if(track.isMuted)await track.unmute();else await track.mute();$('callMic').textContent=track.isMuted?'Unmute mic':'Mute mic';};
$('callCamera').onclick=async()=>{const track=callTracks.find(t=>t.kind===Track.Kind.Video);if(!track)return;if(track.isMuted)await track.unmute();else await track.mute();$('callCamera').textContent=track.isMuted?'Camera on':'Camera off';};
setInterval(()=>{if(!currentUser?.access?.accessAllowed)return;void pollCall();},5000);
setInterval(()=>{if(!currentUser?.access?.accessAllowed||!callOptIn)return;void api('/api/calls/presence',{available:true}).catch(()=>{callOptIn=false;paintCallAvailability();});},20000);
function paintHostGoal(kind,value,target,unit){const count=$(kind+'Target'),remaining=$(kind+'Remaining'),bar=$(kind+'Progress');if(target>0){count.textContent=`${value} / ${target} ${unit}`;bar.hidden=false;bar.setAttribute('aria-valuenow',String(Math.min(value,target)));bar.setAttribute('aria-valuemax',String(target));bar.querySelector('span').style.width=Math.min(100,Math.round(value/target*100))+'%';const left=Math.max(0,Math.round((target-value)*100)/100);remaining.textContent=left?`${left} ${unit} to go this week`:'Weekly target reached';}else{count.textContent='Not set';bar.hidden=true;remaining.textContent='Your programme admin has not set a weekly target.';}}
async function loadHostHub(){try{
 await loadOwnAccess();const [d,g]=await Promise.all([api('/api/host/dashboard'),api('/api/gifts/wallet')]),a=d.access,status=a.hostStatus;
 const active=a.canHost || ['trial','approved','review'].includes(status);
 $('hostStage').textContent=status==='trial'?'Trial host':status==='review'?'Awaiting review':a.canHost?'Approved host':status==='pending'?'Application sent':status==='rejected'?'Application declined':'Viewer';
 const headline=status==='pending'?'Your audition is next':status==='review'?'Your trial is under review':status==='rejected'?'Your application was declined':status==='trial'?'Build your live routine':a.canHost?'Ready to go live':'Become a host';
 const message=status==='pending'?'An admin will arrange your audition outside Veya. You can keep watching lives while you wait.':status==='review'?'An admin will decide whether to continue your host access. You can view your activity below.':status==='rejected'?'You can apply again or contact support from your profile.':status==='trial'?'Go live and work toward your weekly targets. Your trial outcome is decided by an admin.':a.canHost?'Start a live whenever you are ready. Your activity and weekly targets appear below.':'Hosting needs separate approval. Apply first, then an admin will arrange your audition.';
 $('hostHeadline').textContent=headline;$('hostHubStatus').textContent=message;
 $('hostTrialEnd').hidden=!(status==='trial' && d.trial.endsAt);if(status==='trial' && d.trial.endsAt)$('hostTrialEnd').textContent='Trial ends '+new Date(d.trial.endsAt).toLocaleDateString();
 $('hubStart').hidden=!a.canHost;$('hubApply').hidden=a.canHost || a.applicationPending || !a.accessAllowed || a.blocked || status==='review';
 $('hostActiveSections').hidden=!active;$('hostLevelCard').hidden=!active;$('hostCallAvailability').hidden=!a.canHost;paintCallAvailability();if(!active)return;const {progression:hostProgress}=await api('/api/progression');if(hostProgress.host){paintLevel('host',hostProgress.host);}
 const n=h=>Number(h).toLocaleString(undefined,{maximumFractionDigits:2});$('hostTodayHours').textContent=n(d.activity.todayHours);$('hostWeekHours').textContent=n(d.activity.weekHours);$('hostWeekDays').textContent=String(d.activity.weekDays);
 $('hostWeekRange').textContent=new Date(d.activity.weekStart).toLocaleDateString(undefined,{month:'short',day:'numeric'})+' – '+new Date(d.activity.weekEnd-86400000).toLocaleDateString(undefined,{month:'short',day:'numeric'});
 $('hostStats').textContent=`All time: ${n(d.stats.hours)} live hours · ${d.stats.days} live days · ${d.stats.sessions} lives`;
 paintHostGoal('hostHours',d.activity.qualifyingHours,d.trial.requirements.hours,'hours');paintHostGoal('hostDays',d.activity.weekDays,d.trial.requirements.days,'days');
 $('hostRequirements').textContent=d.trial.requirements.dailyCap>0?`Qualifying hours are capped at ${d.trial.requirements.dailyCap} per day. Actual time this week: ${n(d.activity.weekHours)} hours. Dates reset at 00:00 UTC.`:'Tracked live time counts toward the weekly hour target. Dates reset at 00:00 UTC.';
 $('hostEarningsMessage').textContent=d.earnings.message;
 $('hostTestGiftTotal').textContent=g.wallet.receivedPoints+' points';const received=g.wallet.recent.filter(x=>x.recipientId===currentUser.id);$('hostTestGiftRecent').textContent=received.length?received.slice(0,3).map(x=>`${x.senderName} sent ${x.gift} (${x.points})`).join(' · '):'Gifts received during test lives appear here.';
 $('hostBattles').replaceChildren();for(const battle of d.battles||[]){const mine=currentUser.id===battle.hostId?battle.hostPoints:battle.guestPoints,other=currentUser.id===battle.hostId?battle.guestPoints:battle.hostPoints,otherName=currentUser.id===battle.hostId?battle.guestName:battle.hostName;const row=document.createElement('div');row.className='host-session';const copy=document.createElement('div');copy.append(textElement('strong',`${mine>other?'Win':mine<other?'Loss':'Draw'} with ${otherName}`),textElement('span',new Date(battle.endedAt).toLocaleString()));row.append(copy,textElement('span',`${mine}–${other}`));$('hostBattles').append(row);}if(!d.battles?.length)$('hostBattles').append(textElement('p','Your guest battles will appear here after they finish.'));
 $('hostSessions').replaceChildren();for(const session of d.sessions){const row=document.createElement('div');row.className='host-session';const copy=document.createElement('div');copy.append(textElement('strong',new Date(session.startedAt).toLocaleString()),textElement('span',session.endedAt?'Ended':'Active / last connected'));const duration=textElement('span',`${Math.max(0,Math.round((session.lastSeen-session.startedAt)/60000))} min`);row.append(copy,duration);$('hostSessions').append(row);}if(!d.sessions.length){const empty=textElement('p','Your live sessions will appear here after you go live.');empty.className='profile-empty';$('hostSessions').append(empty);}
 }catch(e){notice(e.message);}}
$('hostHubBack').onclick=()=>navigate('profile');
$('profileTestGifts').ontoggle=async()=>{if(!$('profileTestGifts').open)return;try{const wallet=await loadGiftWallet();$('profileGiftSummary').textContent=`${wallet.balance} credits available · ${wallet.sentPoints} sent · ${wallet.receivedPoints} received`;$('profileGiftHistory').replaceChildren();for(const x of wallet.recent){const direction=x.senderId===currentUser.id?`Sent ${x.gift} to ${x.recipientName}`:`Received ${x.gift} from ${x.senderName}`;const row=document.createElement('p');row.className='gift-history-row';const detail=document.createElement('span');detail.textContent=`${direction} · ${x.points} points · ${new Date(x.createdAt).toLocaleString()}`;row.append(giftVisual(x),detail);$('profileGiftHistory').append(row);}if(!wallet.recent.length)$('profileGiftHistory').append(textElement('p','No test gifts yet.'));}catch(error){$('profileGiftSummary').textContent=error.message;}};
$('hubStart').onclick=()=>navigate('studio');$('hubApply').onclick=()=>$('applyHost').click();
function deviceOptions(){return {audio:$('micDevice').value?{deviceId:{exact:$('micDevice').value}}:true,video:{...($('cameraDevice').value?{deviceId:{exact:$('cameraDevice').value}}:{facingMode:'user'}),resolution:{width:640,height:480,frameRate:24}}};}
const cameraLooks=[
 {id:'none',name:'Original',values:[1,1,1,0,0,0],swatch:'linear-gradient(140deg,#565c6e,#a79baa)'},
 {id:'natural',name:'Natural',values:[1.06,1.04,1.08,0,0,0],swatch:'linear-gradient(140deg,#5b786e,#e0b393)'},
 {id:'soft',name:'Soft',values:[1.08,.94,.91,.05,0,0],swatch:'linear-gradient(140deg,#a688ae,#f2c6c3)'},
 {id:'glow',name:'Glow',values:[1.15,.94,1.11,.08,-4,0],swatch:'linear-gradient(140deg,#a36e93,#ffd4a0)'},
 {id:'warm',name:'Warm',values:[1.06,1.05,1.15,.17,-10,0],swatch:'linear-gradient(140deg,#a65a62,#ecaa58)'},
 {id:'cool',name:'Cool',values:[1.04,1.07,1.10,0,16,0],swatch:'linear-gradient(140deg,#426c9c,#a6c3df)'},
 {id:'vivid',name:'Vivid',values:[1.04,1.15,1.35,0,0,0],swatch:'linear-gradient(140deg,#694c9d,#e571aa)'},
 {id:'rose',name:'Rose',values:[1.08,1.02,1.14,.10,-18,0],swatch:'linear-gradient(140deg,#934a76,#f6a8aa)'},
 {id:'vintage',name:'Vintage',values:[1.03,.94,.77,.35,-8,0],swatch:'linear-gradient(140deg,#6a5948,#cda976)'},
 {id:'mono',name:'Mono',values:[1.03,1.14,1,0,0,1],swatch:'linear-gradient(140deg,#333847,#c6c7d0)'},
 {id:'sunny',name:'Sunny',values:[1.18,1.02,1.2,.12,-12,0],swatch:'linear-gradient(140deg,#cd7158,#ffe28c)'},
 {id:'peach',name:'Peach',values:[1.12,.96,1.14,.08,-16,0],swatch:'linear-gradient(140deg,#dc8b83,#ffcfab)'},
 {id:'amber',name:'Amber',values:[1.07,1.1,1.1,.27,-12,0],swatch:'linear-gradient(140deg,#7a402b,#f5ad53)'},
 {id:'lavender',name:'Lilac',values:[1.08,.95,1.08,.04,18,0],swatch:'linear-gradient(140deg,#5c4d9b,#d6a9e8)'},
 {id:'ocean',name:'Ocean',values:[1.04,1.08,1.16,0,35,0],swatch:'linear-gradient(140deg,#164c75,#81c8ce)'},
 {id:'pastel',name:'Pastel',values:[1.16,.86,.86,.05,8,0],swatch:'linear-gradient(140deg,#b4a4d6,#f6c9d1)'},
 {id:'cinema',name:'Cinema',values:[.94,1.24,.86,.12,-5,0],swatch:'linear-gradient(140deg,#25273b,#ad8871)'},
 {id:'crisp',name:'Crisp',values:[1.09,1.22,1.12,0,0,0],swatch:'linear-gradient(140deg,#3e658e,#d1c4aa)'},
 {id:'moody',name:'Moody',values:[.88,1.25,.93,0,9,0],swatch:'linear-gradient(140deg,#242c50,#736574)'},
 {id:'sepia',name:'Sepia',values:[1.03,1.05,.85,.85,0,0],swatch:'linear-gradient(140deg,#66432f,#cfaa77)'},
 {id:'frost',name:'Frost',values:[1.12,.96,.8,0,22,0],swatch:'linear-gradient(140deg,#638ca9,#d4e4f4)'},
 {id:'golden',name:'Golden',values:[1.12,1.1,1.22,.2,-6,0],swatch:'linear-gradient(140deg,#8b6745,#efcb70)'}
];
let cameraLook='none',cameraStrength=70,cameraSoftFocus=0,cameraAdjust={brightness:0,colour:0,contrast:0},cameraSwitch=Promise.resolve();
const faceSettings={Eyes:0,Definition:0,Sparkle:0,Teeth:0,Nose:0,Forehead:0};
let selectedFaceEffect='Eyes';
const faceLabels={Eyes:'Bright eyes',Definition:'Eye definition',Sparkle:'Sparkle',Teeth:'Teeth whitening',Nose:'Nose shape',Forehead:'Forehead shape'};
const faceSymbols={Eyes:'◉',Definition:'◎',Sparkle:'✦',Teeth:'⌣',Nose:'◇',Forehead:'◠'};
function updateFacePicker(){for(const button of $('liveFaceChoices').children)button.setAttribute('aria-pressed',String(button.dataset.effect===selectedFaceEffect));$('liveFaceSelected').textContent=faceLabels[selectedFaceEffect];$('liveFaceAmount').value=String(faceSettings[selectedFaceEffect]);$('liveFaceAmountValue').textContent=faceSettings[selectedFaceEffect]+'%';}
for(const key of Object.keys(faceSettings)){const button=document.createElement('button');button.type='button';button.className='face-choice';button.dataset.effect=key;const symbol=document.createElement('span');symbol.className='face-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=faceSymbols[key];button.append(symbol,document.createTextNode(faceLabels[key]));button.setAttribute('aria-label',faceLabels[key]+' effect');button.onclick=()=>{selectedFaceEffect=key;if(!faceSettings[key]){faceSettings[key]=50;updateCameraLookUI();void loadFaceTracker();scheduleCameraSwitch();}updateFacePicker();};$('liveFaceChoices').append(button);}
$('liveFaceAmount').oninput=()=>{faceSettings[selectedFaceEffect]=Number($('liveFaceAmount').value);updateCameraLookUI();if(faceActive())void loadFaceTracker();scheduleCameraSwitch();};
let faceTrackerPromise=null,faceTracker=null,faceLandmarks=null,faceLastTime=-1,faceLastRun=0;
function faceActive(){return Object.values(faceSettings).some(Boolean);}
function faceFiltersSupported(){return Boolean(document.createElement('canvas').getContext('webgl'));}
function faceStatus(message){for(const id of ['studioFaceStatus','liveFaceStatus'])$(id).textContent=message;}
async function loadFaceTracker(){
 if(faceTrackerPromise)return faceTrackerPromise;
 faceStatus('Loading face tracking…');
 faceTrackerPromise=(async()=>{const {FaceLandmarker,FilesetResolver}=await import('/face.js');const vision=await FilesetResolver.forVisionTasks('/face-wasm');const tracker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'/face_landmarker.task'},runningMode:'VIDEO',numFaces:1});faceTracker=tracker;faceStatus('Face effects ready. They appear when a face is in frame.');return tracker;})().catch(error=>{faceTrackerPromise=null;faceTracker=null;faceStatus('Face effects could not load. Colour filters still work.');console.warn('Face tracking unavailable',error);return null;});
 return faceTrackerPromise;
}
function detectFaceFrame(source){if(!faceActive()||!faceTracker||source.currentTime===faceLastTime||performance.now()-faceLastRun<160)return;faceLastTime=source.currentTime;faceLastRun=performance.now();try{faceLandmarks=faceTracker.detectForVideo(source,faceLastRun).faceLandmarks[0]||null;faceStatus(faceLandmarks?'Face detected. Effects are active.':'Looking for a face in the camera…');}catch{faceLandmarks=null;faceStatus('Face tracking paused. Colour filters still work.');}}

function cameraEffectActive(){return cameraLook!=='none'||cameraSoftFocus>0||Object.values(cameraAdjust).some(Boolean)||faceActive();}
function cameraFiltersSupported(){const canvas=document.createElement('canvas');return typeof canvas.captureStream==='function' && ('filter' in canvas.getContext('2d') || Boolean(document.createElement('canvas').getContext('webgl')));}
function cameraFilterCSS(){const look=cameraLooks.find(x=>x.id===cameraLook)||cameraLooks[0],t=cameraStrength/100,[brightness,contrast,saturate,sepia,hue,mono]=look.values;const mix=value=>1+(value-1)*t;return `brightness(${mix(brightness)*(1+cameraAdjust.brightness/100)}) contrast(${mix(contrast)*(1+cameraAdjust.contrast/100)}) saturate(${mix(saturate)*(1+cameraAdjust.colour/100)}) sepia(${sepia*t}) hue-rotate(${hue*t}deg) grayscale(${mono*t}) blur(${cameraSoftFocus/100}px)`;}
function updateCameraLookUI(){for(const id of ['studioFilters','liveFilters'])for(const button of $(id).children)button.setAttribute('aria-pressed',String(button.dataset.look===cameraLook));for(const id of ['studioFilterStrength','liveFilterStrength'])$(id).value=String(cameraStrength);for(const id of ['studioSoftFocus','liveSoftFocus'])$(id).value=String(cameraSoftFocus);for(const id of ['studioStrengthValue','liveStrengthValue'])$(id).textContent=cameraStrength+'%';for(const id of ['studioSoftValue','liveSoftValue'])$(id).textContent=cameraSoftFocus+'%';for(const key of ['Brightness','Colour','Contrast'])for(const prefix of ['studio','live']){$(prefix+key).value=String(cameraAdjust[key.toLowerCase()]);$(prefix+key+'Value').textContent=String(cameraAdjust[key.toLowerCase()]);}for(const key of Object.keys(faceSettings))for(const prefix of ['studio','live']){$(`${prefix}Face${key}`).value=String(faceSettings[key]);$(`${prefix}Face${key}Value`).textContent=faceSettings[key]+'%';}updateFacePicker();$('cameraPreview').style.filter=previewEffect?'none':cameraFilterCSS();}
for(const container of ['studioFilters','liveFilters'])for(const look of cameraLooks){const button=document.createElement('button');button.type='button';button.className='filter-preset';button.dataset.look=look.id;button.setAttribute('aria-label',look.name+' filter');const swatch=document.createElement('i');swatch.style.background=look.swatch;swatch.setAttribute('aria-hidden','true');button.append(swatch,document.createTextNode(look.name));button.onclick=()=>{cameraLook=look.id;updateCameraLookUI();scheduleCameraSwitch();};$(container).append(button);}
for(const [id,key] of [['studioFilterStrength','strength'],['liveFilterStrength','strength'],['studioSoftFocus','soft'],['liveSoftFocus','soft']])$(id).oninput=()=>{if(key==='strength')cameraStrength=Number($(id).value);else cameraSoftFocus=Number($(id).value);updateCameraLookUI();scheduleCameraSwitch();};
for(const key of ['Brightness','Colour','Contrast'])for(const prefix of ['studio','live'])$(prefix+key).oninput=()=>{cameraAdjust[key.toLowerCase()]=Number($(prefix+key).value);updateCameraLookUI();scheduleCameraSwitch();};
for(const key of Object.keys(faceSettings))for(const prefix of ['studio','live'])$(`${prefix}Face${key}`).oninput=()=>{faceSettings[key]=Number($(`${prefix}Face${key}`).value);updateCameraLookUI();if(faceActive())void loadFaceTracker();scheduleCameraSwitch();};
if(!faceFiltersSupported()){faceStatus('Face effects are unavailable on this device.');for(const key of Object.keys(faceSettings))for(const prefix of ['studio','live'])$(`${prefix}Face${key}`).disabled=true;for(const button of $('liveFaceChoices').children)button.disabled=true;$('liveFaceAmount').disabled=true;}
updateCameraLookUI();
if(!cameraFiltersSupported()){$('filterSupport').textContent='Camera filters are unavailable on this browser; your original camera can still stream.';for(const id of ['studioFilters','studioFilterStrength','studioSoftFocus','studioBrightness','studioColour','studioContrast'])$(id).inert=true;}
for(const id of ['resetStudioFilters','resetLiveFilters'])$(id).onclick=()=>{cameraLook='none';cameraStrength=70;cameraSoftFocus=0;cameraAdjust={brightness:0,colour:0,contrast:0};for(const key of Object.keys(faceSettings))faceSettings[key]=0;faceLandmarks=null;updateCameraLookUI();scheduleCameraSwitch();};
function showFilterTab(tab){for(const [name,panel] of [['Looks','liveLooksPanel'],['Face','liveFacePanel'],['Adjust','liveAdjustPanel']]){$(panel).hidden=name!==tab;$('live'+name+'Tab').setAttribute('aria-selected',String(name===tab));}}
for(const name of ['Looks','Face','Adjust'])$('live'+name+'Tab').onclick=()=>showFilterTab(name);
function closeLiveFilters(){$('liveFilterDialog').hidden=true;$('room').classList.remove('filters-open');}
$('openLiveFilters').onclick=()=>{$('viewersPanel').hidden=true;$('giftPanel').hidden=true;$('liveFilterDialog').hidden=false;$('room').classList.add('filters-open');showFilterTab('Looks');};$('closeLiveFilters').onclick=closeLiveFilters;
function makeGLFilter(canvas){
 const gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL unavailable');
 const shader=(type,code)=>{const sh=gl.createShader(type);gl.shaderSource(sh,code);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error('Filter shader failed');return sh;};
 const vert=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=(p+1.0)*0.5;gl_Position=vec4(p,0.0,1.0);}');
 const frag=shader(gl.FRAGMENT_SHADER,`precision mediump float; varying vec2 uv; uniform sampler2D frame; uniform vec2 pixel; uniform vec4 basic; uniform vec3 tone; uniform float softness;
 uniform vec4 eyeA; uniform vec4 eyeB; uniform vec4 mouth; uniform vec4 nose; uniform vec4 forehead; uniform vec4 faceTones; uniform vec2 faceShape;
 float ellipse(vec2 p,vec4 region){vec2 d=(p-region.xy)/max(region.zw,vec2(.001));return length(d);}
 void main(){
  vec2 sampleAt=uv;
  float n=ellipse(uv,nose);sampleAt.x+=(uv.x-nose.x)*faceShape.x*.3*exp(-n*n*2.0);
  float f=ellipse(uv,forehead);sampleAt.y+=(uv.y-forehead.y)*faceShape.y*.22*exp(-f*f*2.0);
  vec3 c=texture2D(frame,sampleAt).rgb;
  vec3 blurred=(c+texture2D(frame,sampleAt+vec2(pixel.x,0.0)).rgb+texture2D(frame,sampleAt-vec2(pixel.x,0.0)).rgb+texture2D(frame,sampleAt+vec2(0.0,pixel.y)).rgb+texture2D(frame,sampleAt-vec2(0.0,pixel.y)).rgb)/5.0;
  c=mix(c,blurred,softness);c*=basic.x;c=(c-0.5)*basic.y+0.5;
  float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(l),c,basic.z);
  vec3 sep=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131)));c=mix(c,sep,basic.w);
  float a=radians(tone.x);vec3 k=normalize(vec3(1.0));c=c*cos(a)+cross(k,c)*sin(a)+k*dot(k,c)*(1.0-cos(a));l=dot(c,vec3(.2126,.7152,.0722));c=mix(c,vec3(l),tone.y);
  float e=min(ellipse(uv,eyeA),ellipse(uv,eyeB));float inside=1.0-smoothstep(.55,1.0,e);float ring=smoothstep(.42,.7,e)*(1.0-smoothstep(.8,1.15,e));
  c+=vec3(faceTones.x*.24*inside);c*=1.0-faceTones.y*.18*ring;
  vec2 glintA=eyeA.xy+vec2(-eyeA.z*.18,eyeA.w*.2);vec2 glintB=eyeB.xy+vec2(-eyeB.z*.18,eyeB.w*.2);
  float glint=exp(-pow(length((uv-glintA)/max(eyeA.zw,vec2(.001)))*7.0,2.0))+exp(-pow(length((uv-glintB)/max(eyeB.zw,vec2(.001)))*7.0,2.0));c+=vec3(faceTones.z*.45*glint);
  float teeth=1.0-smoothstep(.6,1.0,ellipse(uv,mouth));float light=smoothstep(.28,.7,dot(c,vec3(.2126,.7152,.0722)));c=mix(c,vec3(dot(c,vec3(.2126,.7152,.0722))*.35+.72),faceTones.w*teeth*light*.7);
  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
 }`);
 const program=gl.createProgram();gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Filter program failed');gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.uniform1i(gl.getUniformLocation(program,'frame'),0);gl.uniform2f(gl.getUniformLocation(program,'pixel'),1/canvas.width,1/canvas.height);
 const basic=gl.getUniformLocation(program,'basic'),tone=gl.getUniformLocation(program,'tone'),softness=gl.getUniformLocation(program,'softness');const faceLocations=Object.fromEntries(['eyeA','eyeB','mouth','nose','forehead','faceTones','faceShape'].map(key=>[key,gl.getUniformLocation(program,key)]));
 return source=>{const look=cameraLooks.find(x=>x.id===cameraLook)||cameraLooks[0],t=cameraStrength/100,[b,c,s,sep,h,mono]=look.values;gl.viewport(0,0,canvas.width,canvas.height);gl.uniform4f(basic,(1+(b-1)*t)*(1+cameraAdjust.brightness/100),(1+(c-1)*t)*(1+cameraAdjust.contrast/100),(1+(s-1)*t)*(1+cameraAdjust.colour/100),sep*t);gl.uniform3f(tone,h*t,mono*t,0);gl.uniform1f(softness,cameraSoftFocus/40);
  const points=faceActive()?faceLandmarks:null,xy=i=>[points[i].x,1-points[i].y];
  if(points?.length>=478){const L=xy(468),R=xy(473),mouthTop=xy(13),mouthBottom=xy(14),mouthLeft=xy(61),mouthRight=xy(291),tip=xy(1),noseLeft=xy(98),noseRight=xy(327),brow=xy(9),top=xy(10);
   gl.uniform4f(faceLocations.eyeA,L[0],L[1],Math.max(.014,Math.abs(xy(33)[0]-xy(133)[0])*.5),Math.max(.008,Math.abs(xy(159)[1]-xy(145)[1])*.9));
   gl.uniform4f(faceLocations.eyeB,R[0],R[1],Math.max(.014,Math.abs(xy(362)[0]-xy(263)[0])*.5),Math.max(.008,Math.abs(xy(386)[1]-xy(374)[1])*.9));
   gl.uniform4f(faceLocations.mouth,(mouthLeft[0]+mouthRight[0])/2,(mouthTop[1]+mouthBottom[1])/2,Math.abs(mouthLeft[0]-mouthRight[0])*.46,Math.abs(mouthTop[1]-mouthBottom[1])*.65);
   gl.uniform4f(faceLocations.nose,tip[0],tip[1],Math.max(.015,Math.abs(noseLeft[0]-noseRight[0])*.8),Math.max(.02,Math.abs(tip[1]-brow[1])*.8));
   gl.uniform4f(faceLocations.forehead,top[0],(top[1]+brow[1])/2,Math.abs(L[0]-R[0])*.8,Math.max(.01,Math.abs(top[1]-brow[1])*.7));
   gl.uniform4f(faceLocations.faceTones,faceSettings.Eyes/100,faceSettings.Definition/100,faceSettings.Sparkle/100,faceSettings.Teeth/100);
   gl.uniform2f(faceLocations.faceShape,faceSettings.Nose/100,faceSettings.Forehead/100);
  }else{for(const key of ['eyeA','eyeB','mouth','nose','forehead'])gl.uniform4f(faceLocations[key],-10,-10,.001,.001);gl.uniform4f(faceLocations.faceTones,0,0,0,0);gl.uniform2f(faceLocations.faceShape,0,0);}
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);};
}
function releaseCameraEffect(effect){if(!effect)return;faceLandmarks=null;faceLastTime=-1;clearInterval(effect.timer);effect.source.pause();effect.source.srcObject=null;effect.source.remove();effect.output.stop();}
function stopCameraEffect(){releaseCameraEffect(cameraEffect);cameraEffect=null;}
async function createCameraEffect(track,preview=false){
 if(!cameraFiltersSupported())return null;
 let source,output,timer;
 try{
  source=document.createElement('video');source.autoplay=true;source.muted=true;source.playsInline=true;source.srcObject=new MediaStream([track.mediaStreamTrack]);source.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:.01;pointer-events:none';document.body.append(source);await source.play();
  if(!source.videoWidth)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Camera frames unavailable')),5000);source.onloadeddata=()=>{clearTimeout(timeout);resolve();};});
  const canvas=document.createElement('canvas'),ratio=Math.min(1,640/Math.max(source.videoWidth,source.videoHeight));canvas.width=Math.max(1,Math.round(source.videoWidth*ratio));canvas.height=Math.max(1,Math.round(source.videoHeight*ratio));const supports2d=!faceFiltersSupported() && 'filter' in document.createElement('canvas').getContext('2d');const ctx=supports2d?canvas.getContext('2d',{alpha:false}):null;const paint=ctx ? video=>{ctx.filter=cameraFilterCSS();ctx.drawImage(video,0,0,canvas.width,canvas.height);ctx.filter='none';} : makeGLFilter(canvas);
  const draw=()=>{if(source.readyState<2)return;detectFaceFrame(source);paint(source);};draw();
  output=canvas.captureStream(24).getVideoTracks()[0];if(!output)throw Error('Filtered camera unavailable');timer=setInterval(draw,1000/24);const effect={source,output,timer};if(preview)previewEffect=effect;else cameraEffect=effect;return output;
 }catch(error){clearInterval(timer);output?.stop();source?.pause();if(source){source.srcObject=null;source.remove();}if(!preview){$('openLiveFilters').hidden=true;status('Camera filters unavailable on this device. Streaming your original camera.');}else $('deviceStatus').textContent='Camera effect unavailable here. Previewing the original camera.';return null;}
}
function scheduleCameraSwitch(){schedulePreviewSwitch();cameraSwitch=cameraSwitch.then(async()=>{if(!activeRoom||role!=='host'||!liveRoom)return;const raw=localTracks.find(t=>t.kind===Track.Kind.Video)?.mediaStreamTrack,pub=liveRoom.localParticipant.videoTrackPublications.values().next().value;if(!raw||!pub?.track)return;const wants=cameraEffectActive()&&cameraFiltersSupported();if(wants&&!cameraEffect){const effect=await createCameraEffect(localTracks.find(t=>t.kind===Track.Kind.Video));if(effect){await pub.track.replaceTrack(effect,{userProvidedTrack:true});$('local').dataset.filtered='true';}}else if(!wants&&cameraEffect){await pub.track.replaceTrack(raw,{userProvidedTrack:true});stopCameraEffect();$('local').dataset.filtered='false';}},()=>{}).catch(()=>{status('Could not change the camera filter. Try again.');});}
function stopPreview(){previewGeneration++;releaseCameraEffect(previewEffect);previewEffect=null;for(const t of previewTracks){t.detach();t.stop();}previewTracks=[];$('cameraPreview').srcObject=null;$('cameraPreview').hidden=true;}
function schedulePreviewSwitch(){previewSwitch=previewSwitch.then(async()=>{const raw=previewTracks.find(t=>t.kind===Track.Kind.Video)?.mediaStreamTrack;if(!raw||$('studio').hidden)return;if(cameraEffectActive()&&cameraFiltersSupported()&&!previewEffect){const current=previewGeneration;const output=await createCameraEffect(previewTracks.find(t=>t.kind===Track.Kind.Video),true);if(current!==previewGeneration){releaseCameraEffect(previewEffect);previewEffect=null;return;}if(output){$('cameraPreview').srcObject=new MediaStream([output]);$('cameraPreview').style.filter='none';await $('cameraPreview').play();}}else if(!cameraEffectActive()&&previewEffect){$('cameraPreview').srcObject=new MediaStream([raw]);releaseCameraEffect(previewEffect);previewEffect=null;$('cameraPreview').style.filter=cameraFilterCSS();await $('cameraPreview').play();}},()=>{}).catch(()=>{$('deviceStatus').textContent='Could not update camera preview. Try Check devices again.';});}
async function populateDevices(){const devices=await navigator.mediaDevices.enumerateDevices();for(const [id,kind] of [['cameraDevice','videoinput'],['micDevice','audioinput']]){const select=$(id),previous=select.value;select.replaceChildren();const defaultOption=textElement('option','Default device');defaultOption.value='';select.append(defaultOption);for(const device of devices.filter(d=>d.kind===kind)){const option=textElement('option',device.label || `${kind==='videoinput'?'Camera':'Microphone'} ${select.options.length}`);option.value=device.deviceId;select.append(option);}select.value=previous;}}
$('previewDevices').onclick=async()=>{if(busy)return;$('previewDevices').disabled=true;try{stopPreview();const generation=previewGeneration;const tracks=await createLocalTracks(deviceOptions());if(generation!==previewGeneration || $('studio').hidden){for(const t of tracks)t.stop();return;}previewTracks=tracks;previewTracks.find(t=>t.kind===Track.Kind.Video)?.attach($('cameraPreview'));$('cameraPreview').hidden=false;schedulePreviewSwitch();await previewSwitch;await populateDevices();$('deviceStatus').textContent='Preview is local. Change a device and click Check devices again.';}catch(e){stopPreview();$('deviceStatus').textContent=e.name==='NotAllowedError'?'Allow camera and microphone access to check your devices.':e.message;}finally{$('previewDevices').disabled=false;}};
$('stopPreview').onclick=()=>{stopPreview();$('deviceStatus').textContent='Camera preview stopped.';};
if(window.visualViewport){const fitLiveRoom=()=>document.documentElement.style.setProperty('--live-height',window.visualViewport.height+'px');window.visualViewport.addEventListener('resize',fitLiveRoom);fitLiveRoom();}
setInterval(()=>{void loadConversations();if(!$('messageThread').hidden)void loadMessageThread();void loadUpdates(!$('updates').hidden && inboxSection==='updates');},15000);void loadUpdates();

async function loadProfileStats(){const id=currentUser.id;if(!currentUser.access?.accessAllowed)return;try{const {profile}=await api('/api/public-profile?id='+encodeURIComponent(id));if(currentUser?.id!==id)return;$('profileFollowers').textContent=profile.followers;$('profileFollowing').textContent=profile.following;}catch{}}
$('profileFollowersButton').onclick=()=>openConnections(currentUser.id,'followers');$('profileFollowingButton').onclick=()=>openConnections(currentUser.id,'following');$('publicFollowersButton').onclick=()=>openConnections(publicProfileId,'followers');$('publicFollowingButton').onclick=()=>openConnections(publicProfileId,'following');$('profileHostButton').onclick=()=>navigate('hostHub');
$('profileSettingsButton').onclick=()=>{$('profileAccountSettings').open=true;$('profileAccountSettings').scrollIntoView({behavior:'smooth',block:'start'});$('profileAccountSettings').querySelector('summary').focus({preventScroll:true});};
$('copyAccountId').onclick=async()=>{try{await navigator.clipboard.writeText(currentUser.id);$('copyIdStatus').textContent='Account ID copied.';}catch{$('copyIdStatus').textContent='Select and copy the account ID above.';}};

function paintProfileDetails(prefix,user){const age=$(prefix==='profile'?'profileAgeLabel':'publicAge');age.hidden=user.age===null || user.age===undefined;age.textContent=age.hidden?'':`${user.age} years old`;const hobbies=$(prefix==='profile'?'profileHobbyTags':'publicHobbyTags');hobbies.replaceChildren();const tags=Array.isArray(user.hobbies)?user.hobbies:[];hobbies.hidden=!tags.length;for(const tag of tags)hobbies.append(textElement('span',tag));}

function renderHobbyPicker(selected){$('profileHobbies').replaceChildren();for(const hobby of config.hobbies || []){const label=document.createElement('label');label.className='hobby-option';const input=document.createElement('input');input.type='checkbox';input.value=hobby;input.checked=selected.includes(hobby);input.onchange=updateHobbyPicker;label.append(input,textElement('span',hobby));$('profileHobbies').append(label);}updateHobbyPicker();}
function updateHobbyPicker(){const inputs=[...$('profileHobbies').querySelectorAll('input')];const count=inputs.filter(x=>x.checked).length;const limit=config.maxHobbies || 6;for(const input of inputs)input.disabled=!input.checked && count>=limit;$('hobbyCount').textContent=`${count} / ${limit} selected`;}
$('viewOwnPublicProfile').onclick=()=>openPublicProfile(currentUser.id);
$('postProfilePhoto').onclick=async()=>{const id=currentUser.id;$('postProfilePhoto').disabled=true;try{await openPublicProfile(id);if(publicProfileId===id && !$('publicProfileDialog').hidden){selectProfileTab('moments');$('momentForm').scrollIntoView({behavior:'smooth',block:'start'});}}finally{$('postProfilePhoto').disabled=Boolean(currentUser.profileLocked);}};

function paintCover(element,image){element.replaceChildren();if(image){const img=document.createElement('img');img.src=image;img.alt='';element.append(img);}}
$('bannerFile').onchange=async()=>{const file=$('bannerFile').files[0];if(!file)return;let image;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a photo under 5 MB.');image=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=400;const ctx=canvas.getContext('2d');const ratio=Math.max(1000/image.width,400/image.height);ctx.drawImage(image,(1000-image.width*ratio)/2,(400-image.height*ratio)/2,image.width*ratio,image.height*ratio);draftBanner=canvas.toDataURL('image/jpeg',.75);if(draftBanner.length>250000)throw Error('Choose a simpler cover photo.');paintCover($('bannerPreview'),draftBanner);}catch(e){draftBanner='';$('profileError').textContent=e.message;}finally{image?.close();$('bannerFile').value='';}};
$('removeBanner').onclick=()=>{draftBanner='';paintCover($('bannerPreview'),'');};
async function editAdminProfile(id){try{const {profile}=await api('/api/admin/profile?id='+id);openProfileSetup(true,profile);}catch(e){notice(e.message);}}
async function changeAdminProfile(id,action){if(action==='remove'&&!confirm('Remove this public profile? Its details are retained and can be restored.'))return;try{await api('/api/admin/profile',{userId:id,action});await loadManagement();notice('Profile '+({lock:'locked',unlock:'unlocked',remove:'removed',restore:'restored'}[action])+'.');}catch(e){notice(e.message);}}
window.addEventListener('popstate',()=>{const id=/^\/profile\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];if(currentUser){if(id)void openPublicProfile(id);else navigate('discover');}});

// Community progression. All labels and scores are supplied by the server.
function paintLevel(kind,l){
 const prefix=kind==='host'?'host':'own';
 $(prefix+'LevelLabel').textContent=(kind==='host'?'Host level ':'Level ')+l.number;
 $(prefix+'LevelFill').style.width=l.progress+'%';
 $(prefix+'LevelNext').textContent=l.next===null?'Highest level reached':`${l.next-l.xp} XP to level ${l.number+1}`;
 if(kind==='own')$('ownLevelXp').textContent=l.xp+' XP';
}
function badgePill(b){const el=document.createElement('span');el.className='badge-pill'+(b.earned?'':' unearned');el.title=b.description;const icon=document.createElement('i');icon.textContent=b.icon;el.append(icon,document.createTextNode(b.name));return el;}
async function loadOwnProgression(){
 $('ownProgression').hidden=true;if(!currentUser?.access?.accessAllowed||currentUser.profileRemoved)return;
 try{const id=currentUser.id,{progression:p}=await api('/api/progression');if(currentUser?.id!==id)return;paintLevel('own',p.viewer);
  $('ownBadges').replaceChildren();$('allBadges').replaceChildren();const earned=p.badges.filter(b=>b.earned);
  for(const b of earned.slice(0,4))$('ownBadges').append(badgePill(b));
  if(!earned.length)$('ownBadges').append(textElement('small','Your first badge is ready.'));
  for(const b of p.badges){const row=document.createElement('div');row.className='badge-detail';row.append(badgePill(b),textElement('small',b.description),textElement('small',b.earned?'Earned':b.revoked?'Unavailable':`${Math.min(b.value,b.target)} / ${b.target}`));$('allBadges').append(row);}
  $('ownProgression').hidden=false;
 }catch(e){console.warn('Progression unavailable',e);}
}
$('allBadgesButton').onclick=()=>{const panel=$('allBadges');panel.hidden=!panel.hidden;$('allBadgesButton').textContent=panel.hidden?'See all badges and progress →':'Hide badges ↑';};
async function loadPublicProgression(id){
 $('publicProgression').hidden=true;
 try{const {progression:p}=await api('/api/progression?id='+encodeURIComponent(id));if(publicProfileId!==id)return;
  $('publicLevel').textContent=`Level ${p.viewer.number}`+(p.host?` · Host level ${p.host.number}`:'');
  $('publicBadges').replaceChildren();for(const b of p.badges.filter(x=>x.earned).slice(0,6))$('publicBadges').append(badgePill(b));
  $('publicProgression').hidden=false;
 }catch(e){console.warn('Public progression unavailable',e);}
}
let rankBoard='hosts',rankPeriod='week',rankLoad=0;
async function loadRankings(){
 const version=++rankLoad,target=$('rankList');target.textContent='Loading rankings…';
 try{const data=await api(`/api/leaderboard?board=${rankBoard}&period=${rankPeriod}`);if(version!==rankLoad||$('rankings').hidden)return;
  $('rankCaption').textContent={hosts:'Live minutes from approved hosts',community:'25 XP per Moment and 15 XP per new follower',supporters:'Test credits sent as gifts'}[rankBoard]+(rankPeriod==='week'?' · Resets Monday 00:00 UTC':' · All time');
  target.replaceChildren();for(const x of data.entries){const row=document.createElement('button');row.className='rank-row';row.type='button';row.onclick=()=>openPublicProfile(x.id);const avatar=document.createElement('div');avatar.className='avatar';paintAvatar(avatar,x.displayName,x.avatar);const name=document.createElement('span');name.className='rank-name';name.append(textElement('strong',x.displayName),textElement('small',config.countries?.find(c=>c.code===x.country)?.name||x.country));row.append(textElement('span','#'+x.rank),avatar,name,textElement('span',x.score.toLocaleString()+' '+(rankBoard==='hosts'?'min':rankBoard==='community'?'XP':'credits')));row.firstChild.className='rank-position';row.lastChild.className='rank-score';target.append(row);}
  if(!data.entries.length){const empty=textElement('p','No activity on this board yet. It will fill as members participate.');empty.className='rank-empty';target.append(empty);}
  $('rankOwn').textContent=data.myRank?`Your position: #${data.myRank}`:'Your activity has not placed you on this board yet.';
 }catch(e){if(version===rankLoad)target.textContent=e.message;}
}
$('openRankings').onclick=()=>navigate('rankings');$('rankBack').onclick=()=>navigate('discover');$('hostRankLink').onclick=()=>{rankBoard='hosts';rankPeriod='week';syncRankTabs();navigate('rankings');};
function syncRankTabs(){for(const button of $('rankings').querySelectorAll('[data-board]'))button.setAttribute('aria-pressed',String(button.dataset.board===rankBoard));for(const button of $('rankings').querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===rankPeriod));}
for(const button of $('rankings').querySelectorAll('[data-board]'))button.onclick=()=>{rankBoard=button.dataset.board;syncRankTabs();void loadRankings();};
for(const button of $('rankings').querySelectorAll('[data-period]'))button.onclick=()=>{rankPeriod=button.dataset.period;syncRankTabs();void loadRankings();};

async function loadAdminProgression(selectedId){
 const target=$('adminProgression');target.replaceChildren();const data=await api('/api/admin/progression'+(selectedId?'?id='+encodeURIComponent(selectedId):''));
 const title=textElement('h2','Levels & badges'),hint=textElement('p','Levels use recorded activity. Award or revoke a badge when a manual correction is needed. Excluding an account removes it from every ranking.');target.append(title,hint);
 if(!data.users.length){target.append(textElement('p','No accounts yet.'));return;}
 const choose=document.createElement('select');choose.setAttribute('aria-label','Account to manage');for(const u of data.users){const option=document.createElement('option');option.value=u.id;option.textContent=u.displayName+' · '+u.id.slice(0,8);choose.append(option);}choose.value=selectedId||data.users[0].id;choose.onchange=()=>void loadAdminProgression(choose.value);target.append(choose);
 if(!data.progression){void loadAdminProgression(choose.value);return;}
 const p=data.progression;const summary=document.createElement('div');summary.className='admin-progress-member';summary.append(textElement('strong',`Viewer level ${p.viewer.number}${p.host?' · Host level '+p.host.number:''}`),textElement('p',`${p.counts.followers} followers · ${p.counts.moments} Moments · ${p.counts.lives} lives · ${p.counts.giftsSent} gifts sent`));
 const exclusion=actionButton(p.rankExcluded?'Include in rankings':'Exclude from rankings',async()=>{if(!confirm(`${p.rankExcluded?'Include':'Exclude'} this account ${p.rankExcluded?'in':'from'} rankings?`))return;try{await api('/api/admin/progression',{userId:choose.value,rankExcluded:!p.rankExcluded});await loadAdminProgression(choose.value);}catch(e){notice(e.message);}});summary.append(exclusion);target.append(summary);
 const badge=document.createElement('select');badge.setAttribute('aria-label','Badge');for(const b of data.badges){const option=document.createElement('option');option.value=b.id;option.textContent=b.icon+' '+b.name;badge.append(option);}
 const state=document.createElement('select');state.setAttribute('aria-label','Badge action');for(const [value,label] of [['award','Award badge'],['revoke','Revoke badge'],['auto','Return to automatic']]){const option=document.createElement('option');option.value=value;option.textContent=label;state.append(option);}
 const wrap=document.createElement('div');wrap.className='admin-progress-controls';const badgeLabel=document.createElement('label');badgeLabel.textContent='Badge';badgeLabel.append(badge);const stateLabel=document.createElement('label');stateLabel.textContent='Action';stateLabel.append(state);const save=actionButton('Save',async()=>{save.disabled=true;try{await api('/api/admin/progression',{userId:choose.value,badgeId:badge.value,state:state.value});await loadAdminProgression(choose.value);$('adminSaveStatus').textContent='Badge updated.';}catch(e){$('adminSaveStatus').textContent=e.message;save.disabled=false;}});wrap.append(badgeLabel,stateLabel,save);target.append(wrap);
 const xpTools=document.createElement('div');xpTools.className='admin-progress-controls';
 const xpRole=document.createElement('select');xpRole.setAttribute('aria-label','XP type');for(const type of ['viewer','host']){const option=document.createElement('option');option.value=type;option.textContent=type==='viewer'?'Viewer XP':'Host XP';xpRole.append(option);}
 const amount=document.createElement('input');amount.type='number';amount.step='1';amount.min='-100000';amount.max='100000';amount.value=p.adjustments.viewer;amount.setAttribute('aria-label','XP correction');xpRole.onchange=()=>amount.value=p.adjustments[xpRole.value]||0;
 const xpSave=actionButton('Save XP correction',async()=>{xpSave.disabled=true;try{await api('/api/admin/progression',{userId:choose.value,role:xpRole.value,adjustment:Number(amount.value)});await loadAdminProgression(choose.value);$('adminSaveStatus').textContent='XP correction saved.';}catch(e){$('adminSaveStatus').textContent=e.message;xpSave.disabled=false;}});
 const xpRoleLabel=document.createElement('label');xpRoleLabel.textContent='Level';xpRoleLabel.append(xpRole);const xpAmountLabel=document.createElement('label');xpAmountLabel.textContent='XP correction (can be negative)';xpAmountLabel.append(amount);xpTools.append(xpRoleLabel,xpAmountLabel,xpSave);target.append(textElement('h3','Level correction'),textElement('p','Adds or removes XP from the recorded total. It does not change live hours or test gifts.'),xpTools);
 const list=document.createElement('div');list.className='all-badges';for(const b of p.badges){const item=document.createElement('div');item.className='badge-detail';item.append(badgePill(b),textElement('small',b.earned?'Earned'+(b.manual?' · manual':''):b.revoked?'Revoked':`${b.value} / ${b.target}`));list.append(item);}target.append(list);
 const history=document.createElement('details');history.append(textElement('summary','Recent changes'));for(const x of data.audit)history.append(textElement('p',`${new Date(x.changedAt).toLocaleString()} · ${x.action} · ${x.value} · ${x.userId.slice(0,8)}`));target.append(history);
}

if('serviceWorker' in navigator){const registerWorker=()=>navigator.serviceWorker.register('/sw.js').catch(()=>{});if(document.readyState==='complete')void registerWorker();else window.addEventListener('load',registerWorker,{once:true});}
