import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_FILE=join(mkdtempSync(join(tmpdir(),'veya-account-http-')),'test.sqlite');
process.env.RESEND_API_KEY='unit-test-only';process.env.EMAIL_FROM='Veya <test@example.test>';
const {createApp}=await import('../server.mjs');
test('email APIs enforce origin, deliver verification once, hide unknown accounts, and reset revokes HTTP session',async()=>{
  const realFetch=globalThis.fetch, emails=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://api.resend.com/emails'){emails.push(JSON.parse(options.body));return new Response('{}',{status:200});}
    return realFetch(url,options);
  };
  const {server}=createApp({media:{configured:false}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,input,cookie='',origin=base)=>realFetch(base+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
  try{
    assert.equal((await post('/api/account/verify',{token:'invalid'},'','https://other.example')).status,403);
    const response=await post('/api/register',{email:'member@example.test',displayName:'Member',password:'password that is long enough',adult:true});
    assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal(emails.length,1);
    const token=new URL(emails[0].text.match(/https?:\/\/\S+/)[0]).hash;
    const params=new URLSearchParams(token.slice(1));
    assert.equal((await post('/api/account/verify',{token:params.get('token')})).status,200);
    assert.equal((await (await realFetch(base+'/api/me',{headers:{Cookie:cookie}})).json()).user.emailVerified,true);
    assert.equal((await post('/api/account/verify',{token:params.get('token')})).status,400);
    const unknown=await (await post('/api/account/forgot-password',{email:'missing@example.test'})).json();
    const known=await (await post('/api/account/forgot-password',{email:'member@example.test'})).json();
    assert.deepEqual(known,unknown);assert.equal(emails.length,1); // address cooldown
    const auth=await import('../auth.mjs');const reset=auth.issueAccountToken('member@example.test','reset');
    assert.equal((await post('/api/account/reset-password',{token:reset,password:'replacement password long enough'})).status,200);
    assert.equal((await (await realFetch(base+'/api/me',{headers:{Cookie:cookie}})).json()).user,null);
  }finally{globalThis.fetch=realFetch;await new Promise(r=>server.close(r));delete process.env.RESEND_API_KEY;delete process.env.EMAIL_FROM;}
});
