import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_FILE=join(mkdtempSync(join(tmpdir(),'veya-calls-')),'test.sqlite');
const auth=await import('../auth.mjs');
const access=await import('../access.mjs');
const {CallRegistry}=await import('../calls.mjs');
const make=name=>{const u=auth.register({email:`${name}@example.test`,displayName:name,password:'a long test password',adult:true});return auth.saveProfile(u.id,{displayName:name,country:'GB',adult:true,bio:'',avatar:'',interests:[]});};
const owner=make('CallOwner');process.env.ADMIN_USER_IDS=owner.id;
const viewer=make('CallViewer'),host=make('CallHost'),outsider=make('CallOutsider');
for(const u of [viewer,host,outsider])access.manage(owner,{action:'tester',userId:u.id,approved:true});
access.manage(owner,{action:'host',userId:host.id,status:'trial',days:15});
const media={configured:true,token:async(u,r,role)=>({url:'wss://example.test',token:`${u.id}:${r.id}:${role}`}),end:async()=>{}};

test('only opted-in approved hosts receive private call requests, and only participants see call media',async()=>{
 const calls=new CallRegistry(media);assert.throws(()=>calls.available(viewer,true),/Host approval/);
 await assert.rejects(calls.invite(viewer,host.id),/not available/);
 calls.available(host,true);const initial=await calls.invite(viewer,host.id);assert.equal(initial.call.status,'ringing');
 assert.equal((await calls.state(outsider)).call,null);assert.equal((await calls.state(host)).call.role,'host');
 await assert.rejects(calls.respond(viewer,initial.call.id,true),/expired/);
 const accepted=await calls.respond(host,initial.call.id,true);assert.equal(accepted.call.media.token,`${host.id}:${initial.call.id}:call`);
 assert.equal((await calls.state(viewer)).call.media.token,`${viewer.id}:${initial.call.id}:call`);
 assert.equal(calls.status(host.id),'busy');await calls.end(viewer,initial.call.id);assert.equal((await calls.state(host)).call,null);
});

test('block and expiry prevent contacts from staying active',async()=>{
 const calls=new CallRegistry(media);calls.available(host,true);
 const {blockMessages}=await import('../messages.mjs');blockMessages(host,viewer.id,true);
 await assert.rejects(calls.invite(viewer,host.id),/unavailable/);blockMessages(host,viewer.id,false);
 const {call}=await calls.invite(viewer,host.id);calls.getByRoom(call.id).createdAt-=46_000;
 assert.equal((await calls.state(host)).call,null);assert.equal(calls.status(host.id),'available');
});

test('HTTP call requests require sign-in and same origin',async()=>{
 const {createApp}=await import('../server.mjs');const {server}=createApp({media});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cookie=u=>`veya_session=${auth.createSession(u.id)}`;
 try{
  assert.equal((await fetch(base+'/api/calls/state')).status,401);
  const post=(path,input,user,origin=base)=>fetch(base+path,{method:'POST',headers:{Cookie:cookie(user),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await post('/api/calls/presence',{available:true},host,'https://other.example')).status,403);
  assert.equal((await post('/api/calls/presence',{available:true},host)).status,200);
  const invited=await post('/api/calls/invite',{hostId:host.id},viewer);assert.equal(invited.status,200);
  const id=(await invited.json()).call.id;
  const stranger=await fetch(base+'/api/calls/state',{headers:{Cookie:cookie(outsider)}});assert.equal((await stranger.json()).call,null);
  assert.equal((await post('/api/calls/end',{id},viewer)).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
