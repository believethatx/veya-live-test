// Requires a configured, reachable LiveKit server and Playwright Chromium.
// Uses only synthetic camera/audio devices; it does not record or screenshot streams.
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'veya-browser-'));
process.env.DATA_FILE = join(directory, 'test.sqlite');
const { createApp } = await import('../server.mjs');
const { createMedia } = await import('../media.mjs');
assert.ok(createMedia().configured, 'Configure a test LiveKit server first');
const { server } = createApp(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function account(name, mobile = false) {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('#toggleAccount').click();
  await page.locator('#displayName').fill(name); await page.locator('#adult').check(); await page.locator('#email').fill(`${name}@example.test`); await page.locator('#password').fill('a very long test password'); await page.locator('#submitAccount').click();
  await page.locator('#onboarding').waitFor({state:'visible'}); await page.locator('#profileNext').click(); await page.locator('#profileNext').click(); await page.locator('#discover').waitFor({ state: 'visible' }); return page;
}
try {
  const host = await account('Host');
  const user = await host.evaluate(async () => (await (await fetch('/api/me')).json()).user); process.env.ADMIN_USER_IDS = user.id;
  await host.reload(); await host.locator('#navLive').click(); await host.locator('#title').fill('Browser live test'); await host.locator('#hostRules').check(); await host.locator('#start').click();
  await host.waitForFunction(() => document.getElementById('status').textContent === 'You’re live', null, { timeout: 25000 });
  const viewerA = await account('ViewerA', true), viewerB = await account('ViewerB');
  for (const viewer of [viewerA, viewerB]) {
    await viewer.locator('.room-item').click(); await viewer.locator('#viewerRules').check(); await viewer.locator('#confirmJoin').click();
    await viewer.waitForFunction(() => document.getElementById('remote').videoWidth > 0, null, { timeout: 25000 });
    assert.equal(await viewer.evaluate(() => document.querySelector('video').controls), false);
    assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await host.waitForFunction(() => document.getElementById('viewerCount').textContent === '2');
  await viewerA.locator('#chatText').fill('Real browser chat'); await viewerA.locator('#chatForm button').click(); await viewerB.getByText('Real browser chat', { exact: true }).waitFor();
  await viewerB.locator('#openReport').click(); await viewerB.locator('#reportDetails').fill('Synthetic report test'); await viewerB.locator('#reportForm button').last().click(); await viewerB.getByText('Report received. Thank you for helping keep Veya safe.').waitFor();
  await host.locator('.viewer').filter({ hasText: 'ViewerA' }).getByRole('button', { name: 'Remove' }).click(); await viewerA.getByText('The host removed you from this room.', { exact: true }).waitFor();
  await host.locator('#leave').click(); await viewerB.getByText('The host ended this room.', { exact: true }).waitFor();
  await host.locator('#openAdmin').click(); await host.getByText('Synthetic report test', { exact: true }).waitFor();
  assert.deepEqual(errors, []); console.log('PASS: real media, 2 viewers, mobile layout, chat, report, host removal and cleanup');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
