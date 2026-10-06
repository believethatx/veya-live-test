import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';

const file = resolve(process.env.DATA_FILE || './data/veya.sqlite');
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
    salt TEXT NOT NULL, password_hash TEXT NOT NULL, adult_ack INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );`);
const sessions = db.prepare('SELECT u.id, u.email, u.display_name AS displayName FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?');
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const publicUser = row => ({ id: row.id, email: row.email, displayName: row.displayName });
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

export function register(input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const displayName = String(input.displayName ?? '').trim();
  const password = String(input.password ?? '');
  if (!validEmail(email)) throw Error('Enter a valid email address');
  if (displayName.length < 2 || displayName.length > 40) throw Error('Display name must be 2 to 40 characters');
  if (password.length < 12 || password.length > 128) throw Error('Use a password of 12 to 128 characters');
  if (input.adult !== true) throw Error('You must confirm you are an adult');
  const salt = randomBytes(16).toString('hex');
  const user = { id: randomBytes(16).toString('hex'), email, displayName };
  const hash = scryptSync(password, salt, 64).toString('hex');
  try {
    db.prepare('INSERT INTO users (id,email,display_name,salt,password_hash,adult_ack,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(user.id, email, displayName, salt, hash, 1, new Date().toISOString());
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw Error('Email is already registered');
    throw error;
  }
  return user;
}
export function login(input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const row = db.prepare('SELECT id,email,display_name AS displayName,salt,password_hash FROM users WHERE email=?').get(email);
  const password = String(input.password ?? '');
  const actual = scryptSync(password, row?.salt ?? 'invalid-login-salt', 64);
  const expected = Buffer.from(row?.password_hash ?? '0'.repeat(128), 'hex');
  if (!row || !timingSafeEqual(actual, expected)) throw Error('Incorrect email or password');
  return publicUser(row);
}
export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(tokenHash(token), userId, Date.now() + 7 * 24 * 60 * 60 * 1000);
  return token;
}
export function userFromRequest(req) {
  const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('veya_session='));
  const token = cookie?.slice('veya_session='.length);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = sessions.get(tokenHash(token), Date.now());
  return row ? publicUser(row) : null;
}
export function revokeSession(req) {
  const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('veya_session='));
  const token = cookie?.slice('veya_session='.length);
  if (token && /^[0-9a-f]{64}$/.test(token)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
}
export function sessionCookie(token, secure) {
  return `veya_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`;
}
export const expiredCookie = 'veya_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
