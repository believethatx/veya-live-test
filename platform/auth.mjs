import {COUNTRY_CODES} from './countries.mjs';
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
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email_verified')) db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(provider,subject));
CREATE TABLE IF NOT EXISTS account_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY REFERENCES users(id), bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', interests TEXT NOT NULL DEFAULT '[]', completed INTEGER NOT NULL DEFAULT 0);`);
if(!db.prepare('PRAGMA table_info(profiles)').all().some(c=>c.name==='country'))db.exec("ALTER TABLE profiles ADD COLUMN country TEXT NOT NULL DEFAULT ''");
export const INTERESTS = ['Chat', 'Music', 'Gaming', 'Other'];
for(const [name,definition] of [['age','INTEGER'],['hobbies',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(profiles)').all().some(c=>c.name===name))db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${definition}`);
const profileFor = id => { const p = db.prepare('SELECT bio,avatar,interests,completed,country,age,hobbies FROM profiles WHERE user_id=?').get(id); return {age:p?.age ?? null,hobbies:p?.hobbies || '',bio:p?.bio || '',avatar:p?.avatar || '',interests:p ? JSON.parse(p.interests) : [],country:p?.country || '',onboarded:Boolean(p?.completed && p?.country)}; };
const sessions = db.prepare('SELECT u.id, u.email, u.display_name AS displayName, u.email_verified, u.adult_ack FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?');
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const publicUser = row => ({ id: row.id, email: row.email, displayName: row.displayName, emailVerified: Boolean(row.email_verified), adult: Boolean(row.adult_ack), ...profileFor(row.id) });
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
  return { ...user, emailVerified: false, adult: true, ...profileFor(user.id) };
}
export function login(input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const row = db.prepare('SELECT id,email,display_name AS displayName,email_verified,adult_ack,salt,password_hash FROM users WHERE email=?').get(email);
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

const userById = id => { const row = db.prepare('SELECT id,email,display_name AS displayName,email_verified,adult_ack FROM users WHERE id=?').get(id); return row ? publicUser(row) : null; };
export function confirmAdult(id) { db.prepare('UPDATE users SET adult_ack=1 WHERE id=?').run(id); return userById(id); }
export function saveProfile(id, input) {
  const user = userById(id); if (!user) throw Error('Sign in first');
  if(!COUNTRY_CODES.has(input.country))throw Error('Select your country');
  const name = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (name.length < 2 || name.length > 40) throw Error('Display name must be 2 to 40 characters');
  if (typeof input.bio !== 'string' || input.bio.length > 160) throw Error('Keep your bio under 160 characters');
  if (!Array.isArray(input.interests) || input.interests.length > 4 || input.interests.some(x => !INTERESTS.includes(x))) throw Error('Choose interests from the list');
  if (!user.adult && input.adult !== true) throw Error('Confirm you are 18 or older');
  const age=input.age===undefined ? user.age : input.age;const hobbies=input.hobbies===undefined ? user.hobbies : input.hobbies;
  if(age!==null && (!Number.isInteger(age) || age<18 || age>120))throw Error('Age must be a whole number from 18 to 120, or left blank');
  if(typeof hobbies!=='string' || hobbies.length>120)throw Error('Keep hobbies under 120 characters');
  const avatar = input.avatar ?? '';
  if (typeof avatar !== 'string' || avatar.length > 150000) throw Error('Choose a smaller profile photo');
  if (avatar) {
    const match = avatar.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw Error('Use a JPG or PNG profile photo');
    const bytes = Buffer.from(match[2], 'base64');
    if (!(match[1] === 'jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255])) : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw Error('Invalid profile photo');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET display_name=?,adult_ack=1 WHERE id=?').run(name,id);
    db.prepare('INSERT INTO profiles (user_id,bio,avatar,interests,completed,country,age,hobbies) VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,avatar=excluded.avatar,interests=excluded.interests,completed=1,country=excluded.country,age=excluded.age,hobbies=excluded.hobbies').run(id,input.bio.trim(),avatar,JSON.stringify([...new Set(input.interests)]),input.country,age,hobbies.trim());
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
  return userById(id);
}
export function socialAccount(provider, subject, profile, existingUser = null) {
  if (!['google', 'facebook'].includes(provider) || typeof subject !== 'string' || !subject.length || subject.length > 255) throw Error('Invalid social account');
  const identity = db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?').get(provider, subject);
  if (identity) { if (existingUser && existingUser.id !== identity.user_id) throw Error('This social account is connected to another Veya account'); return userById(identity.user_id); }
  if (existingUser) { db.prepare('INSERT INTO identities VALUES (?,?,?)').run(provider, subject, existingUser.id); return userById(existingUser.id); }
  const email = String(profile.email || '').trim().toLowerCase();
  if (!validEmail(email)) throw Error('An email address is required. Use email sign-up or grant email access.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw Error('Sign in to your existing Veya account first, then connect this provider in Account settings.');
  const id = randomBytes(16).toString('hex');
  const name = String(profile.name || 'Veya member').trim().slice(0,40) || 'Veya member';
  const salt = randomBytes(16).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO users (id,email,display_name,salt,password_hash,adult_ack,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?)').run(id,email,name,salt,scryptSync(randomBytes(32),salt,64).toString('hex'),0,new Date().toISOString(),provider === 'google' && profile.email_verified === true ? 1 : 0);
    db.prepare('INSERT INTO identities VALUES (?,?,?)').run(provider,subject,id); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return userById(id);
}
export function issueAccountToken(email, purpose) {
  if (!['verify', 'reset'].includes(purpose)) throw Error('Invalid token purpose');
  const user = db.prepare('SELECT id,email_verified FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!user || (purpose === 'verify' && user.email_verified)) return null;
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM account_tokens WHERE user_id=? AND purpose=?').run(user.id,purpose);
  db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?)').run(tokenHash(token),user.id,purpose,Date.now() + (purpose === 'reset' ? 30 : 60) * 60_000);
  return token;
}
export function consumeAccountToken(token, purpose, password) {
  if (!/^[0-9a-f]{64}$/.test(String(token))) throw Error('This link is invalid or expired');
  if (purpose === 'reset' && (typeof password !== 'string' || password.length < 12 || password.length > 128)) throw Error('Use a password of 12 to 128 characters');
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT user_id FROM account_tokens WHERE token_hash=? AND purpose=? AND expires_at>?').get(tokenHash(token),purpose,Date.now());
    if (!row) throw Error('This link is invalid or expired');
    if (purpose === 'verify') db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(row.user_id);
    else if (purpose === 'reset') {
      const salt = randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,scryptSync(password,salt,64).toString('hex'),row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
    } else throw Error('Invalid token purpose');
    db.prepare('DELETE FROM account_tokens WHERE user_id=? AND purpose=?').run(row.user_id,purpose);
    db.exec('COMMIT'); return userById(row.user_id);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
