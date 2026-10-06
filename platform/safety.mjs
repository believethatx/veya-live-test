import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
export const POLICY_VERSION = '2026-10-06';
export const reasons = new Set(['Recording or screenshots', 'Harassment', 'Unsafe content', 'Other']);
const file = resolve(process.env.DATA_FILE || './data/veya.sqlite');
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, room_id TEXT NOT NULL,
  host_id TEXT NOT NULL, host_name TEXT NOT NULL, room_title TEXT NOT NULL,
  reason TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
);`);
export const isAdmin = user => Boolean(user && String(process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user.id));
export function reportRoom(user, room, reason, details) {
  if (!reasons.has(reason)) throw Error('Choose a report reason');
  details = String(details ?? '').trim().slice(0, 1000);
  const id = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO reports (id,reporter_id,room_id,host_id,host_name,room_title,reason,details,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, user.id, room.id, room.hostId, room.hostName, room.title, reason, details, new Date().toISOString());
  return id;
}
export function listReports(user) {
  if (!isAdmin(user)) throw Error('Admin access required');
  return db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200').all();
}
export function resolveReport(user, id) {
  if (!isAdmin(user)) throw Error('Admin access required');
  return db.prepare("UPDATE reports SET status='reviewed' WHERE id=?").run(String(id)).changes;
}
