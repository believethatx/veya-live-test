import {test} from 'node:test';import {strict as assert} from 'node:assert';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {WebSocket} from 'ws';
process.env.DATA_FILE=join(mkdtempSync(join(tmpdir(),'veya-access-')),'access.sqlite');
const auth=await import('../auth.mjs');const access=await import('../access.mjs');const {createApp}=await import('../server.mjs');const {POLICY_VERSION}=await import('../safety.mjs');
const account=name=>auth.register({email:`${name}@example.test`,displayName:name,password:'a long test password',adult:true});
const owner=account('Owner');process.env.ADMIN_USER_IDS=owner.id;
const profile=u=>auth.saveProfile(u.id,{displayName:u.displayName,bio:'',avatar:'',interests:[],adult:true,country:'GB'});
const req={headers:{},socket:{remoteAddress:'203.0.113.40'}};
test('tester and host approval are independent; trials expire; only scoped admin powers work',()=>{
 const viewer=profile(account('Viewer'));assert.equal(access.accessFor(viewer,req).accessAllowed,false);
 access.manage(owner,{action:'tester',userId:viewer.id,approved:true});assert.equal(access.accessFor(viewer,req).accessAllowed,true);assert.equal(access.accessFor(viewer,req).canHost,false);
 assert.throws(()=>access.assertAccess(viewer,req,true),/host approval/);access.applyHost(viewer,{});
 assert.throws(()=>access.manage(owner,{action:'host',userId:viewer.id,status:'approved'}),/start on a trial/);
 access.manage(owner,{action:'host',userId:viewer.id,status:'trial',days:2});assert.equal(access.accessFor(viewer,req).canHost,true);
 const now=Date.now;Date.now=()=>now()+3*86400000;try{assert.equal(access.accessFor(viewer,req).canHost,false);}finally{Date.now=now;}
 access.manage(owner,{action:'host',userId:viewer.id,status:'approved'});assert.equal(access.accessFor(viewer,req).canHost,true);
 const admin=account('Scoped');access.manage(owner,{action:'permissions',userId:admin.id,permissions:['hosts']});assert.equal(access.hasPermission(admin,'hosts'),true);assert.equal(access.hasPermission(admin,'moderation'),false);
 assert.throws(()=>access.manage(admin,{action:'tester',userId:viewer.id,approved:false}),/permission/);assert.throws(()=>access.manage(admin,{action:'permissions',userId:viewer.id,permissions:['settings']}),/Only the owner/);
 access.manage(admin,{action:'host',userId:viewer.id,status:'viewer'});assert.equal(access.accessFor(viewer,req).canHost,false);assert.equal(access.accessFor(viewer,req).accessAllowed,true);
});
test('account, phone and IP blocks persist, expire, allow appeals, and cannot suspend the owner',()=>{
 const u=profile(account('Blocked'));access.manage(owner,{action:'tester',userId:u.id,approved:true});access.rememberConnection(u,req);access.savePhone(u,'+447700900001');
 assert.throws(()=>access.manage(owner,{action:'block',userId:owner.id,kind:'account',reason:'bad'}),/Owner/);
 access.manage(owner,{action:'block',userId:u.id,kind:'phone',reason:'Review needed',days:1});assert.equal(access.accessFor(u,req).blocked,true);
 const same=profile(account('SamePhone'));access.savePhone(same,'+447700900001');assert.equal(access.accessFor(same,req).blocked,true);
 access.appeal(u,'Please review this decision.');assert.throws(()=>access.appeal(u,'Another appeal please.'),/open appeal/);
 const data=access.management(owner);const block=data.blocks.find(b=>b.kind==='phone');access.manage(owner,{action:'unblock',blockId:block.id});assert.equal(access.accessFor(u,req).blocked,false);
 access.manage(owner,{action:'block',userId:u.id,kind:'ip',reason:'IP review',days:1});assert.equal(access.accessFor(same,req).blocked,true);const now=Date.now;Date.now=()=>now()+2*86400000;try{assert.equal(access.accessFor(u,req).blocked,false);}finally{Date.now=now;}
});
test('viewer cannot bypass host approval through direct WebSocket messages',async()=>{
 const viewer=profile(account('SocketViewer'));access.manage(owner,{action:'tester',userId:viewer.id,approved:true});const cookie=`veya_session=${auth.createSession(viewer.id)}`;
 const {server}=createApp({media:{configured:true,token:async()=>{throw Error('Should never issue token');}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const ws=new WebSocket(base.replace('http','ws')+'/signal',{headers:{Cookie:cookie,Origin:base}});
 try{await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const reply=new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('No rejection')),3000);ws.once('message',m=>{clearTimeout(timer);r(JSON.parse(m));});});ws.send(JSON.stringify({type:'create',title:'Bypass attempt',acceptRules:true,policyVersion:POLICY_VERSION}));assert.match((await reply).message,/host approval/);}
 finally{ws.terminate();await new Promise(r=>server.close(r));}
});
