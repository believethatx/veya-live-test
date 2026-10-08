import {HOBBIES,MAX_HOBBIES} from './hobbies.mjs';
import {publicProfile,people,connections,follow,moments,createMoment,likeMoment,removeMoment,notify,notifyLive,notifications,readNotifications,hostDashboard} from './community.mjs';
import {COUNTRIES} from './countries.mjs';
import {adminProfile,accessFor,assertAccess,clientIP,rememberConnection,management,manage,applyHost,savePhone,appeal,ownAppeals,hasPermission,expireTrials,startHours,touchHours,endHours} from './access.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry } from './rooms.mjs';
import { createMedia } from './media.mjs';
import { POLICY_VERSION, isAdmin, reportRoom, listReports, resolveReport } from './safety.mjs';
import { accountConfig, createOAuthFlow, sendAccountEmail } from './accounts.mjs';
import { socialAccount, confirmAdult, saveProfile, issueAccountToken, consumeAccountToken, register, login, createSession, userFromRequest, revokeSession, sessionCookie, expiredCookie } from './auth.mjs';
import {TEST_GIFTS,testGiftWallet,sendTestGift,testGiftAdminHistory,giftCatalog,giftCatalogAudit,updateGiftCatalog} from './gifts.mjs';
import {progression,leaderboard,updateProgression,progressionAudit,progressionUsers,BADGES} from './progression.mjs';
import {conversations,conversation,sendMessage,blockMessages,removeConversation} from './messages.mjs';
import {CallRegistry} from './calls.mjs';

export function createApp({ media = createMedia() } = {}) {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'public');
  const rooms = new RoomRegistry();
  const calls = new CallRegistry(media,id=>[...rooms.peers.keys()].some(s=>s.user.id===id));
  const attempts = new Map();
  const oauth = createOAuthFlow();
  const emailRequests = new Map();
  const mailLimits = {day: Math.floor(Date.now()/86_400_000), sent:0};
  async function deliverLink(email,purpose,origin) {
    const now=Date.now(), day=Math.floor(now/86_400_000);
    if(mailLimits.day !== day) {mailLimits.day=day;mailLimits.sent=0;}
    for(const [key,time] of emailRequests) if(now-time > 60_000) emailRequests.delete(key);
    if(emailRequests.has(email) || mailLimits.sent >= 100) return;
    emailRequests.set(email,now);mailLimits.sent++;
    const token=issueAccountToken(email,purpose);
    if(token) await sendAccountEmail(email,purpose,token,origin).catch(()=>console.error('Account email delivery failed'));
  }
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/discover.css':['discover.css','text/css; charset=utf-8'], '/calls.css':['calls.css','text/css; charset=utf-8'], '/gift-extras.css':['gift-extras.css','text/css; charset=utf-8'], '/livekit.js': ['livekit.js', 'text/javascript; charset=utf-8'], '/lottie-light.min.js':['lottie-light.min.js','text/javascript; charset=utf-8'], '/face.js': ['face.js', 'text/javascript; charset=utf-8'], '/face_landmarker.task':['face_landmarker.task','application/octet-stream'], '/face-wasm/vision_wasm_internal.js':['face-wasm/vision_wasm_internal.js','text/javascript; charset=utf-8'], '/face-wasm/vision_wasm_nosimd_internal.js':['face-wasm/vision_wasm_nosimd_internal.js','text/javascript; charset=utf-8'], '/face-wasm/vision_wasm_internal.wasm':['face-wasm/vision_wasm_internal.wasm.gz','application/wasm','gzip'], '/face-wasm/vision_wasm_nosimd_internal.wasm':['face-wasm/vision_wasm_nosimd_internal.wasm.gz','application/wasm','gzip'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], ...Object.fromEntries(['veya-scenes','veya-sparkle','veya-premium'].map(id=>[`/gifts/${id}.webp`,[`gifts/${id}.webp`,'image/webp']])), ...Object.fromEntries(['sa','ae','kw','qa','eg','ps','iq','lb'].map(id=>[`/gifts/flags/${id}.svg`,[`gifts/flags/${id}.svg`,'image/svg+xml']])), ...Object.fromEntries(['heart','star','flower','crown'].map(id=>[`/gifts/${id}.svg`,[`gifts/${id}.svg`,'image/svg+xml']])), ...Object.fromEntries(TEST_GIFTS.filter(g=>g.codepoint).flatMap(g=>[[`/gifts/thumbs/${g.codepoint}.svg`,[`gifts/thumbs/${g.codepoint}.svg`,'image/svg+xml']],[`/gifts/animated/${g.codepoint}.json`,[`gifts/animated/${g.codepoint}.json`,'application/json']]])) };
  const send = (socket, value) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const secureRequest = req => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  const requestOrigin = req => process.env.APP_ORIGIN || `${secureRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
  const publicUser = (user,req) => user && ({ ...user, admin: isAdmin(user), access:accessFor(user,req) });
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(), fullscreen=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss: ws:; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  async function body(req, limit = 4096) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw Error('Request too large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function jsonBody(req, limit = 4096) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Error('JSON body required');
    return JSON.parse(await body(req, limit));
  }
  function json(res, code, value, headers = {}) {
    res.writeHead(code, { ...securityHeaders, 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value));
  }
  function roster(room) {
    const viewers = [...room.viewers].filter(s => rooms.peer(s)?.ready).map(s => ({ id: s.user.id, name: s.user.displayName }));
    send(room.host, { type: 'roster', viewers });
    const participants=[{id:room.host.user.id,name:room.host.user.displayName},...viewers];
    for (const socket of rooms.participants(room)) {send(socket, { type: 'viewers', count: viewers.length });send(socket,{type:'participants',participants});}
  }
  async function endRoom(room, message = 'The host ended this room.') {
    endHours(room);rooms.leave(room.host);
    for (const peer of rooms.participants(room)) { send(peer, { type: 'ended', message }); peer.close(1000, 'Room ended'); }
    try { await media.end(room); } catch { console.error('Media room cleanup failed'); }
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, requestOrigin(req));
      expireTrials();const sessionUser=userFromRequest(req);rememberConnection(sessionUser,req);
      const authMatch = url.pathname.match(/^\/auth\/(google|facebook)(\/callback)?$/);
      if (req.method === 'GET' && authMatch) {
        const provider = authMatch[1];
        const user = userFromRequest(req);
        const cookieName = `veya_oauth_${provider}`;
        const clear = `${cookieName}=; HttpOnly; SameSite=Lax; Path=/auth/${provider}; Max-Age=0${secureRequest(req) ? '; Secure' : ''}`;
        try {
          if (!authMatch[2]) {
            const start = oauth.start(provider, requestOrigin(req), user?.id || null);
            res.writeHead(302, { ...securityHeaders, Location:start.url, 'Set-Cookie':`${cookieName}=${start.binding}; HttpOnly; SameSite=Lax; Path=/auth/${provider}; Max-Age=600${secureRequest(req) ? '; Secure' : ''}` }); res.end(); return;
          }
          const binding = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
          const result = await oauth.finish(provider,url.searchParams.get('state'),binding,url.searchParams.get('code'),user?.id || null);
          const account = socialAccount(provider,result.subject,result.profile,user);
          res.writeHead(302,{...securityHeaders,Location:'/', 'Set-Cookie':[clear,sessionCookie(createSession(account.id),secureRequest(req))]});res.end();return;
        } catch {
          res.writeHead(302,{...securityHeaders,Location:'/#authError=1','Set-Cookie':clear});res.end();return;
        }
      }
      if (req.url === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, mediaConfigured: media.configured }); return; }
      if (req.url === '/api/config' && req.method === 'GET') { json(res, 200, { mediaConfigured: media.configured, policyVersion: POLICY_VERSION, accounts: accountConfig(), countries:COUNTRIES,hobbies:HOBBIES,maxHobbies:MAX_HOBBIES }); return; }
      if (req.url === '/api/me' && req.method === 'GET') { json(res, 200, { user: publicUser(userFromRequest(req),req) }); return; }
      if (req.url === '/api/rooms' && req.method === 'GET') {
        if (!userFromRequest(req)) { json(res, 401, { error: 'Sign in first' }); return; }
        try{assertAccess(userFromRequest(req),req);}catch(e){json(res,403,{error:e.message});return;}
        json(res, 200, { rooms: rooms.list() }); return;
      }
      if(req.url==='/api/gifts/wallet' && req.method==='GET'){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}
        assertAccess(sessionUser,req);json(res,200,{wallet:testGiftWallet(sessionUser)});return;
      }
      if(req.url==='/api/admin/test-gifts' && req.method==='GET'){
        if(!hasPermission(sessionUser,'moderation')&&!hasPermission(sessionUser,'gifts')){json(res,403,{error:'Gift management access required'});return;}
        json(res,200,{testOnly:true,transfers:testGiftAdminHistory()});return;
      }
      if(req.url==='/api/admin/gift-catalog' && req.method==='GET'){
        if(!hasPermission(sessionUser,'gifts')){json(res,403,{error:'Gift management access required'});return;}
        json(res,200,{testOnly:true,gifts:giftCatalog(true),audit:giftCatalogAudit()});return;
      }
      if(url.pathname==='/api/progression' && req.method==='GET'){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
        const id=url.searchParams.get('id') || sessionUser.id;
        publicProfile(sessionUser,id);
        const {adjustments,rankExcluded,...visibleProgression}=progression(id);
        json(res,200,{progression:visibleProgression});return;
      }
      if(url.pathname==='/api/leaderboard' && req.method==='GET'){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
        json(res,200,leaderboard(sessionUser,url.searchParams.get('board')||'hosts',url.searchParams.get('period')||'week'));return;
      }
      if(url.pathname==='/api/admin/progression' && req.method==='GET'){
        if(!hasPermission(sessionUser,'progression')){json(res,403,{error:'Progression management access required'});return;}
        const id=url.searchParams.get('id');json(res,200,{badges:BADGES,users:progressionUsers(sessionUser),audit:progressionAudit(sessionUser),progression:id?progression(id):null});return;
      }
      if (req.url === '/api/admin/reports' && req.method === 'GET') {
        const user = userFromRequest(req);
        if (!hasPermission(user,'moderation')) { json(res, 403, { error: 'Moderation access required' }); return; }
        json(res, 200, { reports: listReports(user) }); return;
      }
      if(req.method==='GET' && ['/api/people','/api/public-profile','/api/connections','/api/moments','/api/notifications','/api/host/dashboard'].includes(url.pathname)){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}
        if(url.pathname!=='/api/host/dashboard'){try{assertAccess(sessionUser,req);}catch(e){json(res,403,{error:e.message});return;}}
        if(url.pathname==='/api/people')json(res,200,{people:people(sessionUser,{following:url.searchParams.get('following')==='1',search:url.searchParams.get('q') || '',hostsOnly:url.searchParams.get('hosts')==='1'}).map(p=>({...p,callStatus:p.isHost?calls.status(p.id):null}))});
        else if(url.pathname==='/api/public-profile')json(res,200,{profile:publicProfile(sessionUser,url.searchParams.get('id'))});
        else if(url.pathname==='/api/connections')json(res,200,connections(sessionUser,url.searchParams.get('id'),url.searchParams.get('kind'),Number(url.searchParams.get('offset') || 0)));
        else if(url.pathname==='/api/moments')json(res,200,{moments:moments(sessionUser,url.searchParams.get('id'))});
        else if(url.pathname==='/api/notifications')json(res,200,notifications(sessionUser));
        else json(res,200,hostDashboard(sessionUser,req));return;
      }
      if(req.url==='/api/access' && req.method==='GET'){if(!sessionUser){json(res,401,{error:'Sign in first'});return;}json(res,200,{access:accessFor(sessionUser,req),appeals:ownAppeals(sessionUser)});return;}
      if(req.url==='/api/calls/state' && req.method==='GET'){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);json(res,200,await calls.state(sessionUser));return;
      }
      if(req.method==='GET' && ['/api/conversations','/api/messages'].includes(url.pathname)){
        if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
        json(res,200,url.pathname==='/api/conversations'?{conversations:conversations(sessionUser)}:conversation(sessionUser,url.searchParams.get('userId')));return;
      }
      if(url.pathname==='/api/admin/profile' && req.method==='GET'){json(res,200,{profile:adminProfile(sessionUser,url.searchParams.get('id'))});return;}
      if(req.url==='/api/admin/management' && req.method==='GET'){if(!isAdmin(sessionUser)){json(res,403,{error:'Admin access required'});return;}json(res,200,management(sessionUser));return;}
      if (req.url === '/api/livekit/webhook' && req.method === 'POST') {
        try {
          const event = await media.webhook(await body(req, 65536), req.headers.authorization);
          const room = rooms.rooms.get(event.room?.name);
          const call=calls.getByRoom(event.room?.name);
          if (event.event === 'participant_joined') {
            const peer = room && rooms.participants(room).find(s => s.user.id === event.participant?.identity);
            if (!room && (!call||call.status!=='active'||![call.callerId,call.hostId].includes(event.participant?.identity))) await media.end({ id: event.room?.name });
            else if (room && (!peer || room.blocked.has(event.participant?.identity))) await media.remove(room, event.participant.identity);
          }
          if (event.event === 'participant_left' && call) await calls.finish(call);
          if (event.event === 'participant_left' && room) {
            const peer = rooms.participants(room).find(s => s.user.id === event.participant?.identity);
            if (peer) { send(peer, { type: 'ended', message: 'The live connection ended.' }); peer.close(1000, 'Media disconnected'); }
          }
          if (event.event === 'room_finished' && room) await endRoom(room, 'The live connection ended.');
          if (event.event === 'room_finished' && call) await calls.finish(call);
          json(res, 200, { ok: true });
        } catch { json(res, 401, { error: 'Invalid media webhook' }); }
        return;
      }
      if (req.url?.startsWith('/api/') && req.method === 'POST') {
        if (req.headers.origin !== requestOrigin(req)) { json(res, 403, { error: 'Invalid origin' }); return; }
        if(req.url==='/api/admin/gift-catalog'){
          if(!hasPermission(sessionUser,'gifts')){json(res,403,{error:'Gift management access required'});return;}
          const input=await jsonBody(req);
          json(res,200,{gift:updateGiftCatalog(sessionUser,String(input.giftId||''),input.points,input.enabled)});return;
        }
        if(req.url==='/api/admin/progression'){
          if(!hasPermission(sessionUser,'progression')){json(res,403,{error:'Progression management access required'});return;}
          json(res,200,{progression:updateProgression(sessionUser,await jsonBody(req))});return;
        }
        if(['/api/calls/presence','/api/calls/invite','/api/calls/respond','/api/calls/end'].includes(req.url)){
          if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
          if(!sessionUser.adult||(accountConfig().email&&!sessionUser.emailVerified))throw Error('Verify your account before using calls');
          const input=await jsonBody(req);
          if(req.url==='/api/calls/presence')json(res,200,calls.available(sessionUser,input.available));
          else if(req.url==='/api/calls/invite')json(res,200,await calls.invite(sessionUser,String(input.hostId||'')));
          else if(req.url==='/api/calls/respond')json(res,200,await calls.respond(sessionUser,String(input.id||''),input.accept));
          else json(res,200,await calls.end(sessionUser,String(input.id||'')));return;
        }
        if(['/api/messages/send','/api/messages/block','/api/messages/remove'].includes(req.url)){
          if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
          const input=await jsonBody(req);const id=String(input.userId||'');
          if(req.url==='/api/messages/send')json(res,200,{item:sendMessage(sessionUser,id,input.body)});
          else if(req.url==='/api/messages/block')json(res,200,blockMessages(sessionUser,id,input.enabled));
          else json(res,200,removeConversation(sessionUser,id));return;
        }
        if (req.url === '/api/logout') {
          const user = userFromRequest(req); revokeSession(req);
          if(user)await calls.leaveUser(user.id);
          for (const socket of wss.clients) if (socket.user.id === user?.id && !userFromRequest(socket.request)) socket.close(1000, 'Signed out');
          json(res, 200, { ok: true }, { 'Set-Cookie': expiredCookie }); return;
        }
        if(['/api/follow','/api/notifications/read'].includes(req.url)){
          if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);const input=await jsonBody(req);
          if(req.url==='/api/follow'){if(typeof input.enabled!=='boolean')throw Error('Choose follow or unfollow');json(res,200,{profile:follow(sessionUser,String(input.userId),input.enabled)});}
          else{readNotifications(sessionUser,input.ids);json(res,200,{ok:true});}return;
        }
        if(['/api/moments/create','/api/moments/like','/api/moments/remove'].includes(req.url)){
          if(!sessionUser){json(res,401,{error:'Sign in first'});return;}assertAccess(sessionUser,req);
          const input=await jsonBody(req,req.url==='/api/moments/create'?170000:4096);
          if(req.url==='/api/moments/create')json(res,200,{id:createMoment(sessionUser,input)});
          else if(req.url==='/api/moments/like'){if(typeof input.enabled!=='boolean')throw Error('Choose like or unlike');json(res,200,likeMoment(sessionUser,String(input.id),input.enabled));}
          else{removeMoment(sessionUser,String(input.id));json(res,200,{ok:true});}return;
        }
        if(['/api/host/apply','/api/access/phone','/api/access/appeal','/api/admin/manage'].includes(req.url)){
          const user=userFromRequest(req);if(!user){json(res,401,{error:'Sign in first'});return;}const input=await jsonBody(req);
          if(req.url==='/api/admin/manage'){if(!isAdmin(user)){json(res,403,{error:'Admin access required'});return;}manage(user,input);
            if(input.userId && ['tester','host','block'].includes(input.action))await calls.leaveUser(String(input.userId));
            if(input.userId && ['tester','host'].includes(input.action))notify(String(input.userId),'access',input.action==='tester' ? input.approved ? 'Your tester access has been approved.' : 'Your tester access has been removed.' : `Your host status is now ${input.status}.`);
            if(input.action==='appeal'){const appealRow=management(user).appeals.find(a=>a.id===input.appealId);if(appealRow)notify(appealRow.user_id,'appeal','An admin replied to your appeal.');}
            for(const socket of wss.clients){try{assertAccess(socket.user,socket.request,rooms.peer(socket)?.role==='host');}catch(e){send(socket,{type:'ended',message:e.message});socket.close(1008,'Access changed');}}
          }else if(req.url==='/api/host/apply'){assertAccess(user,req);applyHost(user,input);}
          else if(req.url==='/api/access/phone'){if(accessFor(user,req).blocked)throw Error('Phone changes are unavailable during a suspension');savePhone(user,input.phone);}
          else appeal(user,input.message);
          json(res,200,{user:publicUser(user,req)});return;
        }
        if(req.url==='/api/admin/profile'){const user=userFromRequest(req);if(!user){json(res,401,{error:'Sign in first'});return;}const input=await jsonBody(req,450000);const profile=adminProfile(user,input.userId,input);json(res,200,{profile});return;}
        if (req.url === '/api/profile') {
          const user = userFromRequest(req); if (!user) {json(res,401,{error:'Sign in first'});return;}
          if ([...wss.clients].some(s => s.user.id === user.id && rooms.peer(s))) throw Error('Leave your live room before editing your profile');
          const updated = saveProfile(user.id, await jsonBody(req, 450000));
          json(res,200,{user:publicUser(updated,req)});return;
        }
        if (req.url?.startsWith('/api/admin/')) {
          const user = userFromRequest(req);
          if (!hasPermission(user,'moderation')) { json(res, 403, { error: 'Moderation access required' }); return; }
          const input = await jsonBody(req);
          if (req.url === '/api/admin/end-room') {
            const room = rooms.rooms.get(String(input.roomId));
            if (!room) { json(res, 404, { error: 'Room has ended' }); return; }
            await endRoom(room, 'This room was ended by moderation.'); json(res, 200, { ok: true }); return;
          }
          if (req.url === '/api/admin/review-report') { json(res, 200, { ok: Boolean(resolveReport(user, input.reportId)) }); return; }
          json(res, 404, { error: 'Not found' }); return;
        }
        if (!['/api/register', '/api/login', '/api/account/adult', '/api/account/send-verification', '/api/account/forgot-password', '/api/account/verify', '/api/account/reset-password'].includes(req.url)) { json(res, 404, { error: 'Not found' }); return; }
        const ip = clientIP(req) || req.socket.remoteAddress || 'unknown';
        const history = (attempts.get(ip) || []).filter(time => Date.now() - time < 60_000);
        if (history.length >= 8) { json(res, 429, { error: 'Too many attempts. Wait a minute.' }); return; }
        history.push(Date.now()); attempts.set(ip, history);
        const input = await jsonBody(req);
        if (req.url === '/api/account/adult') {
          const user = userFromRequest(req); if (!user || input.adult !== true) throw Error('Confirm you are 18 or older');
          json(res,200,{user:publicUser(confirmAdult(user.id),req)});return;
        }
        if (req.url === '/api/account/send-verification' || req.url === '/api/account/forgot-password') {
          if (!accountConfig().email) throw Error('Email delivery is not connected yet');
          const purpose = req.url.endsWith('forgot-password') ? 'reset' : 'verify';
          const user = userFromRequest(req);
          if (purpose === 'verify' && !user) { json(res,401,{error:'Sign in first'});return; }
          const email = purpose === 'verify' ? user.email : String(input.email || '').trim().toLowerCase();
          // Same response for unknown, verified, throttled and existing addresses.
          await deliverLink(email,purpose,requestOrigin(req));
          json(res,200,{ok:true,message:'If eligible, a link has been sent. Check your inbox and spam folder.'});return;
        }
        if (req.url === '/api/account/verify' || req.url === '/api/account/reset-password') {
          const purpose = req.url.endsWith('reset-password') ? 'reset' : 'verify';
          consumeAccountToken(input.token,purpose,input.password);
          json(res,200,{ok:true});return;
        }
        const user = req.url === '/api/register' ? register(input) : login(input);
        if (req.url === '/api/register' && accountConfig().email) await deliverLink(user.email,'verify',requestOrigin(req));
        json(res, 200, { user: publicUser(user,req) }, { 'Set-Cookie': sessionCookie(createSession(user.id), secureRequest(req)) }); return;
      }
      const requestedPath = req.url?.split('?')[0];const path=/^\/profile\/[0-9a-f]{32}$/.test(requestedPath)?'/':requestedPath;
      if (req.method !== 'GET' || !files[path]) { res.writeHead(404, securityHeaders); res.end('Not found'); return; }
      const [file, type, encoding] = files[path]; const data = await readFile(join(root, file));
      res.writeHead(200, { ...securityHeaders, 'Content-Type': type, ...(path.startsWith('/gifts/')||path==='/lottie-light.min.js'?{'Cache-Control':'public, max-age=86400'}:{}), ...(encoding?{'Content-Encoding':encoding}:{}) }); res.end(data);
    } catch (error) { json(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON' : error.message }); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const user = userFromRequest(req);
    try{assertAccess(user,req);}catch{socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    if (user && (!user.country || !user.onboarded || !user.adult || (accountConfig().email && !user.emailVerified))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    if (req.url !== '/signal' || req.headers.origin !== requestOrigin(req) || !user) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.user = user; ws.request = req; wss.emit('connection', ws); });
  });
  wss.on('connection', socket => {
    let lastChat = 0, lastReport = 0, received = [], processing = Promise.resolve();
    socket.alive = true; socket.on('pong', () => { socket.alive = true; });
    socket.on('message', raw => {
      received = received.filter(time => Date.now() - time < 1000);
      if (received.length >= 12) { socket.close(1008, 'Too many messages'); return; }
      received.push(Date.now());
      processing = processing.then(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!userFromRequest(socket.request)) { socket.close(1008, 'Sign in again'); return; }
        const msg = JSON.parse(raw);
        expireTrials();assertAccess(socket.user,socket.request,msg.type==='create' || rooms.peer(socket)?.role==='host');
        if (msg.type === 'create' || msg.type === 'join') {
          if (!media.configured) throw Error('Live video is not connected yet');
          if (msg.policyVersion !== POLICY_VERSION || msg.acceptRules !== true) throw Error('Accept the room privacy rules first');
          const room = msg.type === 'create' ? rooms.create(socket, msg.title) : rooms.join(socket, msg.roomId);
          try {
            const credentials = await media.token(socket.user, room, msg.type === 'create' ? 'host' : 'viewer');
            if (socket.readyState !== WebSocket.OPEN || !rooms.peer(socket)) { if (msg.type === 'create') await media.end(room); return; }
            send(socket, { type: msg.type === 'create' ? 'created' : 'joined', room: { id: room.id, title: room.title, hostId: room.hostId, hostName: room.hostName }, media: credentials });
          } catch (error) { rooms.leave(socket); throw error; }
          return;
        }
        const entry = rooms.peer(socket);
        if (!entry) throw Error('Join a room first');
        if (msg.type === 'ready') {
          await media.verify(entry.room, socket.user, entry.role);
          if (!rooms.peer(socket) || socket.readyState !== WebSocket.OPEN) return;
          const firstReady=!entry.ready;rooms.ready(socket);if(entry.role==='host'){startHours(entry.room,socket.user);if(firstReady)notifyLive(entry.room);} send(socket, { type: 'ready' }); roster(entry.room); return;
        }
        if (msg.type === 'chat') {
          if (!entry.ready) throw Error('Connect to the live room first');
          if (Date.now() - lastChat < 800) throw Error('Please slow down');
          const text = String(msg.text ?? '').trim().slice(0, 280); if (!text) return;
          lastChat = Date.now();
          for (const peer of rooms.participants(entry.room)) send(peer, { type: 'chat', userId: socket.user.id, name: socket.user.displayName, text }); return;
        }
        if(msg.type==='gift'){
          try{
            if(!entry.ready)throw Error('Connect to the live room first');
            const recipient=rooms.participants(entry.room).find(peer=>peer.user.id===msg.recipientId && rooms.peer(peer)?.ready);
            if(!recipient)throw Error('That person is no longer in this live');
            const result=sendTestGift(socket.user,recipient.user,entry.room.id,msg.giftId,msg.requestId);
            send(socket,{type:'gift-sent',requestId:msg.requestId,balance:result.balance});
            if(!result.duplicate)for(const peer of rooms.participants(entry.room))send(peer,{type:'gift',...result.event});
          }catch(error){send(socket,{type:'gift-error',requestId:msg.requestId,message:error.message});}
          return;
        }
        if (msg.type === 'kick') {
          const target = rooms.kick(socket, String(msg.userId));
          send(target, { type: 'ended', message: 'The host removed you from this room.' }); target.close(1000, 'Removed by host');
          roster(entry.room); await media.remove(entry.room, target.user.id); return;
        }
        if (msg.type === 'report') {
          if (Date.now() - lastReport < 30_000) throw Error('Your report was received. Please wait before sending another.');
          const id = reportRoom(socket.user, entry.room, msg.reason, msg.details); lastReport = Date.now();
          send(socket, { type: 'reported', id }); return;
        }
        if (msg.type === 'leave') { socket.close(1000, 'Left room'); return; }
        throw Error('Unknown message');
      }).catch(error => send(socket, { type: 'error', message: error instanceof SyntaxError ? 'Invalid message' : error.message }));
    });
    socket.on('close', () => {
      const entry = rooms.peer(socket); if (!entry) return;
      if (entry.role === 'host') void endRoom(entry.room);
      else { rooms.leave(socket); roster(entry.room); void media.remove(entry.room, socket.user.id).catch(() => console.error('Media participant cleanup failed')); }
    });
    socket.on('error', () => socket.terminate());
  });
  const heartbeat = setInterval(() => {
    expireTrials();
    for (const socket of wss.clients) {
      try{assertAccess(socket.user,socket.request,rooms.peer(socket)?.role==='host');}catch(e){send(socket,{type:'ended',message:e.message});socket.close(1008,'Access changed');continue;}
      if(rooms.peer(socket)?.role==='host')touchHours(rooms.peer(socket).room);
      if (!socket.alive || !userFromRequest(socket.request)) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
    for (const [ip, times] of attempts) if (!times.some(t => Date.now() - t < 60_000)) attempts.delete(ip);
  }, 15_000);
  heartbeat.unref(); server.on('close', () => { clearInterval(heartbeat); for (const socket of wss.clients) socket.terminate(); wss.close(); });
  return { server, rooms };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Veya live server ready'));
}
