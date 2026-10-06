import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_FILE=join(mkdtempSync(join(tmpdir(),'veya-profile-')),'profile.sqlite');
const auth=await import('../auth.mjs');
const {createApp}=await import('../server.mjs');
test('profile completion persists in sessions and validates age, interests and photo content',()=>{
 const user=auth.socialAccount('google','profile-google',{email:'profile@example.test',name:'Profile',email_verified:true});
 const req={headers:{cookie:`veya_session=${auth.createSession(user.id)}`}};
 const input={displayName:'Updated name',bio:'Music and games',age:23,hobbies:['Music','Football'],interests:['Music','Music'],avatar:'',adult:true,country:'GB'};
 assert.equal(auth.userFromRequest(req).onboarded,false);
 assert.throws(()=>auth.saveProfile(user.id,{...input,adult:false}),/18 or older/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,interests:['invalid']}),/interests/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,avatar:'data:image/svg+xml;base64,PHN2Zz4='}),/JPG or PNG/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,avatar:'data:image/jpeg;base64,YmFk'}),/Invalid profile/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,bio:'x'.repeat(161)}),/160/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,age:17}),/Age must/);assert.throws(()=>auth.saveProfile(user.id,{...input,age:23.5}),/Age must/);assert.throws(()=>auth.saveProfile(user.id,{...input,hobbies:['anything typed']}),/hobbies/);
 auth.saveProfile(user.id,input);
 const saved=auth.userFromRequest(req);assert.equal(saved.onboarded,true);assert.equal(saved.adult,true);assert.equal(saved.displayName,input.displayName);assert.deepEqual(saved.interests,['Music']);assert.equal(saved.bio,input.bio);assert.equal(saved.age,23);assert.deepEqual(saved.hobbies,input.hobbies);auth.saveProfile(user.id,{...input,age:null,hobbies:[]});assert.equal(auth.userFromRequest(req).age,null);assert.deepEqual(auth.userFromRequest(req).hobbies,[]);
});
test('profile API requires session and origin, edits only the current account',async()=>{
 const {server}=createApp({media:{configured:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const user=auth.register({email:'http-profile@example.test',displayName:'Before',password:'long profile password',adult:true});
 const other=auth.register({email:'other-profile@example.test',displayName:'Other',password:'long other password',adult:true});
 const cookie=`veya_session=${auth.createSession(user.id)}`;
 const data={userId:other.id,displayName:'After',bio:'About me',interests:['Gaming'],avatar:'',adult:true,country:'GB'};
 const post=headers=>fetch(`${base}/api/profile`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  assert.equal((await post({Origin:base})).status,401);
  assert.equal((await post({Origin:'https://elsewhere.test',Cookie:cookie})).status,403);
  const result=await post({Origin:base,Cookie:cookie});assert.equal(result.status,200);assert.equal((await result.json()).user.displayName,'After');
  assert.equal(auth.login({email:other.email,password:'long other password'}).displayName,'Other');
 }finally{await new Promise(r=>server.close(r));}
});

test('admin profile permission, lock, recoverable removal, privacy and deep links',async()=>{
 const access=await import('../access.mjs');const community=await import('../community.mjs');
 const owner=auth.register({email:'profile-owner@example.test',displayName:'Owner',password:'long owner password',adult:true});process.env.ADMIN_USER_IDS=owner.id;
 const target=auth.register({email:'profile-target@example.test',displayName:'Target',password:'long target password',adult:true});
 const input={displayName:'Custom profile',country:'GB',bio:'Hello',avatar:'',banner:'',theme:'ocean',interests:[],age:25,hobbies:['Music']};
 auth.saveProfile(target.id,input);access.manage(owner,{action:'tester',userId:target.id,approved:true});
 const {server}=createApp({media:{configured:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cookie=u=>`veya_session=${auth.createSession(u.id)}`;const ownerCookie=cookie(owner),targetCookie=cookie(target);
 const post=(path,data,c=ownerCookie,origin=base)=>fetch(base+path,{method:'POST',headers:{Cookie:c,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  assert.equal((await fetch(base+'/profile/'+target.id)).status,200);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'lock'},targetCookie)).status,400);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'lock'},ownerCookie,'https://other.test')).status,403);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'lock'})).status,200);
  assert.equal((await post('/api/profile',input,targetCookie)).status,400);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'save',profile:{...input,theme:'rose',bio:'Admin updated'}})).status,200);
  assert.equal(auth.userById(target.id).bio,'Admin updated');assert.equal(auth.userById(target.id).theme,'rose');
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'remove'})).status,200);
  assert.throws(()=>community.publicProfile(owner,target.id),/unavailable/);assert.equal(auth.userById(target.id).onboarded,true);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'restore'})).status,200);
  assert.equal(community.publicProfile(owner,target.id).bio,'Admin updated');assert.equal(auth.userById(target.id).profileLocked,true);
  assert.equal((await post('/api/admin/profile',{userId:target.id,action:'unlock'})).status,200);
  assert.equal((await post('/api/profile',input,targetCookie)).status,200);
  assert.equal((await post('/api/admin/profile',{userId:owner.id,action:'remove'})).status,400);
  assert.throws(()=>auth.saveProfile(target.id,{...input,theme:'url(evil)'}),/theme/);
  assert.throws(()=>auth.saveProfile(target.id,{...input,banner:'data:image/svg+xml;base64,PHN2Zz4='}),/JPG or PNG/);
  const social=auth.socialAccount('google','admin-unconfirmed',{email:'unconfirmed@example.test',name:'Unconfirmed'});
  access.adminProfile(owner,social.id,{action:'save',profile:input});assert.equal(auth.userById(social.id).adult,false);
  assert.ok(access.management(owner).audit.some(a=>a.action==='profile-remove'));
 }finally{await new Promise(r=>server.close(r));}
});
