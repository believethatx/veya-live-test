import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(),'veya-accounts-')),'accounts.sqlite');
const auth = await import('../auth.mjs');
const {createOAuthFlow} = await import('../accounts.mjs');

test('verification tokens expire, are purpose-bound and cannot be replayed; reset revokes sessions', () => {
  const input = {email:'verify@example.test',displayName:'Member',password:'old password long enough',adult:true};
  const user = auth.register(input);
  const request = {headers:{cookie:`veya_session=${auth.createSession(user.id)}`}};
  const token = auth.issueAccountToken(input.email,'verify');
  assert.throws(() => auth.consumeAccountToken(token,'reset','new password long enough'),/invalid or expired/);
  assert.equal(auth.consumeAccountToken(token,'verify').emailVerified,true);
  assert.throws(() => auth.consumeAccountToken(token,'verify'),/invalid or expired/);
  assert.equal(auth.issueAccountToken('unknown@example.test','reset'),null);
  const reset = auth.issueAccountToken(input.email,'reset');
  assert.throws(() => auth.consumeAccountToken(reset,'reset','short'),/12 to 128/);
  auth.consumeAccountToken(reset,'reset','new password long enough');
  assert.equal(auth.userFromRequest(request),null);
  assert.throws(() => auth.login(input),/Incorrect/);
  assert.equal(auth.login({...input,password:'new password long enough'}).id,user.id);
  const expired = auth.issueAccountToken(input.email,'reset');
  const now=Date.now; Date.now=()=>now()+31*60_000;
  try {assert.throws(()=>auth.consumeAccountToken(expired,'reset','new password long enough'),/expired/);} finally {Date.now=now;}
});
test('provider identity cannot take over a matching email; linking requires existing account; age acknowledgement stays explicit', () => {
  const owner=auth.register({email:'owner@example.test',displayName:'Owner',password:'owner password long enough',adult:true});
  assert.throws(()=>auth.socialAccount('facebook','attacker',{email:owner.email,name:'Other'}),/existing Veya account/);
  const linked=auth.socialAccount('google','owner-google',{email:owner.email,email_verified:true},owner);
  assert.equal(linked.id,owner.id);
  const other=auth.socialAccount('google','new-google',{email:'new@example.test',name:'New',email_verified:true});
  assert.equal(other.emailVerified,true);assert.equal(other.adult,false);
  assert.equal(auth.confirmAdult(other.id).adult,true);
  assert.throws(()=>auth.socialAccount('google','owner-google',{},other),/another Veya/);
  const facebook=auth.socialAccount('facebook','new-facebook',{email:'facebook@example.test',name:'Facebook'});
  assert.equal(facebook.emailVerified,false);
});
test('OAuth callbacks reject wrong browser, provider and expired state before contacting providers', async () => {
  process.env.GOOGLE_CLIENT_ID='unit-client';process.env.GOOGLE_CLIENT_SECRET='unit-secret';
  const flow=createOAuthFlow();
  const start=flow.start('google','https://veya.example');
  const url=new URL(start.url);const state=url.searchParams.get('state');
  assert.ok(url.searchParams.get('code_challenge'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  await assert.rejects(flow.finish('google',state,'wrong-browser','code'),/expired/);
  await assert.rejects(flow.finish('google',state,start.binding,'code'),/expired/);
  const second=flow.start('google','https://veya.example','signed-in-user');
  await assert.rejects(flow.finish('google',new URL(second.url).searchParams.get('state'),second.binding,'code','another-user'),/expired/);
  const third=flow.start('google','https://veya.example');
  const now=Date.now;Date.now=()=>now()+601_000;
  try {await assert.rejects(flow.finish('google',new URL(third.url).searchParams.get('state'),third.binding,'code'),/expired/);}finally{Date.now=now;}
  delete process.env.GOOGLE_CLIENT_ID;delete process.env.GOOGLE_CLIENT_SECRET;
});
