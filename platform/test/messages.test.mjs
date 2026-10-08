import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_FILE=join(mkdtempSync(join(tmpdir(),'veya-messages-')),'test.sqlite');
const auth=await import('../auth.mjs');
const access=await import('../access.mjs');
const community=await import('../community.mjs');
const messages=await import('../messages.mjs');
const make=name=>{const u=auth.register({email:`${name}@example.test`,displayName:name,password:'a long test password',adult:true});return auth.saveProfile(u.id,{displayName:name,country:'GB',adult:true,bio:'',avatar:'',interests:[]});};
const a=make('Alice'),b=make('Basil'),c=make('Cora');
let firstMessageId;
process.env.ADMIN_USER_IDS=a.id;
for(const user of [b,c])access.manage(a,{action:'tester',userId:user.id,approved:true});

test('direct messages require an approved visible relationship and are only visible to participants',()=>{
 assert.throws(()=>messages.sendMessage(a,b.id,'Hello'),/Follow/);
 community.follow(a,b.id,true);
 const sent=messages.sendMessage(a,b.id,'Hello');
 firstMessageId=sent.id;
 assert.equal(messages.conversation(b,a.id).items[0].body,'Hello');
 assert.equal(messages.conversations(b)[0].unread,0);
 assert.equal(messages.conversations(c).length,0);
 assert.throws(()=>messages.conversation(c,'no-such-person'),/unavailable/);
 assert.throws(()=>messages.sendMessage(a,c.id,'Hi'),/Follow/);
 assert.equal(sent.senderId,a.id);
});

test('block, unblock and remove conversation require explicit actions',()=>{
 messages.blockMessages(b,a.id,true);
 assert.throws(()=>messages.sendMessage(a,b.id,'Blocked'),/unavailable/);
 messages.blockMessages(b,a.id,false);
 assert.equal(messages.conversation(a,b.id).blocked,false);
 messages.removeConversation(b,a.id);
 assert.equal(messages.conversations(b).length,0);
 assert.equal(messages.conversation(a,b.id).items.length,1);
});

test('recipient can report one message without exposing the conversation to other users',async()=>{
 const safety=await import('../safety.mjs');const message={id:firstMessageId};
 assert.throws(()=>messages.reportableMessage(a,message.id),/only report/);
 assert.throws(()=>messages.reportableMessage(c,message.id),/only report/);
 const snapshot=messages.reportableMessage(b,message.id);assert.equal(snapshot.body,'Hello');
 safety.reportMessage(b,snapshot,'Harassment','Please review');
 assert.throws(()=>safety.reportMessage(b,snapshot,'Other','Again'),/already reported/);
 assert.throws(()=>safety.listMessageReports(b),/Moderation/);
 const report=safety.listMessageReports(a)[0];assert.equal(report.body,'Hello');
 assert.equal(safety.resolveMessageReport(a,report.id),1);
});

test('message HTTP endpoints enforce session, access and origin',async()=>{
 const {createApp}=await import('../server.mjs');const {server}=createApp({media:{configured:false}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cookie=`veya_session=${auth.createSession(a.id)}`;
 try{
  assert.equal((await fetch(base+'/api/conversations')).status,401);
  assert.equal((await fetch(base+'/api/messages?userId='+b.id,{headers:{Cookie:cookie}})).status,200);
  const post=(origin)=>fetch(base+'/api/messages/remove',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({userId:b.id})});
  assert.equal((await post('https://other.example')).status,403);
  assert.equal((await post(base)).status,200);
  const message={id:firstMessageId},recipientCookie=`veya_session=${auth.createSession(b.id)}`;
  const report=await fetch(base+'/api/messages/report',{method:'POST',headers:{Cookie:recipientCookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({messageId:message.id,reason:'Other',details:'Duplicate'})});
  assert.equal(report.status,400); // already reported by this recipient
  assert.equal((await fetch(base+'/api/admin/message-reports',{headers:{Cookie:recipientCookie}})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
