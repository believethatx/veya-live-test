import {chromium} from 'playwright';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'veya-pwa-'));process.env.DATA_FILE=join(directory,'test.sqlite');
const {createApp}=await import('../server.mjs');const {server}=createApp({media:{configured:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
try{
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();await page.goto(base);
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();assert.equal(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),true);
 const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();assert.equal(manifest.name,'Veya Live');assert.ok(manifest.icons.some(x=>x.sizes==='512x512'));
 const keys=await page.evaluate(async()=>({keys:await caches.keys(),urls:(await (await caches.open((await caches.keys())[0])).keys()).map(x=>x.url)}));
 assert.deepEqual(keys.urls.map(x=>new URL(x).pathname).sort(),['/icon-192.png','/offline.html']);
 const port=server.address().port;await new Promise(r=>server.close(r));await page.reload();await page.getByText("You're offline",{exact:true}).waitFor();
 assert.equal(await page.locator('img.icon').isVisible(),true);
 await new Promise(r=>server.listen(port,'127.0.0.1',r));await page.reload();await page.locator('#account').waitFor({state:'visible'});
 console.log('PASS: app manifest/icons, offline handoff, online recovery and no private API cache');await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
