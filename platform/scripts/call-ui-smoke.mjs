import {chromium} from 'playwright';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'veya-call-ui-'));process.env.DATA_FILE=join(directory,'test.sqlite');
const auth=await import('../auth.mjs');const access=await import('../access.mjs');const {createApp}=await import('../server.mjs');
const make=name=>{const u=auth.register({email:`${name}@example.test`,displayName:name,password:'a long test password',adult:true});return auth.saveProfile(u.id,{displayName:name,country:'EG',adult:true,bio:'',avatar:'',interests:[]});};
const owner={id:'local-owner'},host=make('Host'),viewer=make('Viewer');process.env.ADMIN_USER_IDS=owner.id;
for(const u of [host,viewer])access.manage(owner,{action:'tester',userId:u.id,approved:true});access.manage(owner,{action:'host',userId:host.id,status:'trial',days:15});
const media={configured:true,token:async()=>({url:'wss://media.example.test',token:'test-only'}),end:async()=>{}};
const {server}=createApp({media});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 const errors=[];const pageFor=async user=>{const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'veya_session',value:auth.createSession(user.id),url:base}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#discover').waitFor({state:'visible'});return {context,page};};
 const h=await pageFor(host),v=await pageFor(viewer);
 await h.page.locator('#navProfile').click();await h.page.locator('#profileHostButton').click();await h.page.locator('#hostCallToggle').click();await h.page.getByText('Available while this app is open.',{exact:false}).waitFor();
 await v.page.locator('[data-explore=hosts]').click();await v.page.locator('#hostDirectory .discover-host-card').waitFor();await v.page.locator('#hostDirectory .host-card-actions').getByRole('button',{name:'Call'}).click();await v.page.locator('#callScreen').waitFor({state:'visible'});
 await h.page.locator('#callScreen').waitFor({state:'visible',timeout:15000});assert.equal(await h.page.locator('#callAccept').isVisible(),true);await h.page.locator('#callAccept').click();await h.page.locator('#callConnect').waitFor({state:'visible'});
 await v.page.locator('#callConnect').waitFor({state:'visible',timeout:15000});await v.page.locator('#callHangup').click();await v.page.locator('#discover').waitFor({state:'visible'});await h.page.locator('#discover').waitFor({state:'visible',timeout:15000});
 assert.deepEqual(errors,[]);console.log('PASS: mobile host availability, call request, accept, and hangup UI');
 await h.context.close();await v.context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
