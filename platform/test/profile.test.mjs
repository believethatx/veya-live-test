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
 const input={displayName:'Updated name',bio:'Music and games',age:23,hobbies:'Music, football',interests:['Music','Music'],avatar:'',adult:true,country:'GB'};
 assert.equal(auth.userFromRequest(req).onboarded,false);
 assert.throws(()=>auth.saveProfile(user.id,{...input,adult:false}),/18 or older/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,interests:['invalid']}),/interests/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,avatar:'data:image/svg+xml;base64,PHN2Zz4='}),/JPG or PNG/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,avatar:'data:image/jpeg;base64,YmFk'}),/Invalid profile/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,bio:'x'.repeat(161)}),/160/);
 assert.throws(()=>auth.saveProfile(user.id,{...input,age:17}),/Age must/);assert.throws(()=>auth.saveProfile(user.id,{...input,age:23.5}),/Age must/);assert.throws(()=>auth.saveProfile(user.id,{...input,hobbies:'x'.repeat(121)}),/hobbies/);
 auth.saveProfile(user.id,input);
 const saved=auth.userFromRequest(req);assert.equal(saved.onboarded,true);assert.equal(saved.adult,true);assert.equal(saved.displayName,input.displayName);assert.deepEqual(saved.interests,['Music']);assert.equal(saved.bio,input.bio);assert.equal(saved.age,23);assert.equal(saved.hobbies,input.hobbies);auth.saveProfile(user.id,{...input,age:null,hobbies:''});assert.equal(auth.userFromRequest(req).age,null);assert.equal(auth.userFromRequest(req).hobbies,'');
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
