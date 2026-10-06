import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'veya-auth-'));
process.env.DATA_FILE = join(directory, 'test.sqlite');
const auth = await import('../auth.mjs');
test('account login, session expiry on logout, and duplicate email', () => {
  const user = auth.register({ email: 'Someone@Example.com', displayName: 'Someone', password: 'long private password', adult: true });
  assert.equal(auth.login({ email: 'someone@example.com', password: 'long private password' }).id, user.id);
  assert.throws(() => auth.login({ email: 'someone@example.com', password: 'incorrect password' }), /Incorrect/);
  assert.throws(() => auth.register({ email: 'someone@example.com', displayName: 'Else', password: 'another long password', adult: true }), /already registered/);
  const token = auth.createSession(user.id);
  const request = { headers: { cookie: `veya_session=${token}` } };
  assert.equal(auth.userFromRequest(request).id, user.id);
  auth.revokeSession(request);
  assert.equal(auth.userFromRequest(request), null);
  rmSync(directory, { recursive: true, force: true });
});
