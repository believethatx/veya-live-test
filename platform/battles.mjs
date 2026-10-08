import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const file=resolve(process.env.DATA_FILE||'./data/veya.sqlite');mkdirSync(dirname(file),{recursive:true});
const db=new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS battle_results (
 id TEXT PRIMARY KEY,room_id TEXT NOT NULL,host_id TEXT NOT NULL,guest_id TEXT NOT NULL,
 host_name TEXT NOT NULL,guest_name TEXT NOT NULL,host_points INTEGER NOT NULL,guest_points INTEGER NOT NULL,
 started_at INTEGER NOT NULL,ended_at INTEGER NOT NULL
);CREATE INDEX IF NOT EXISTS battle_results_users ON battle_results(host_id,ended_at DESC);CREATE INDEX IF NOT EXISTS battle_results_guests ON battle_results(guest_id,ended_at DESC);`);
export function recordBattle(room,state){if(!state||state.active)return;db.prepare('INSERT OR IGNORE INTO battle_results VALUES(?,?,?,?,?,?,?,?,?,?)').run(`${room.id}:${state.startedAt}`,room.id,state.hostId,state.guestId,state.hostName,state.guestName,state.hostPoints,state.guestPoints,state.startedAt,Date.now());}
export function ownBattles(user){return db.prepare('SELECT host_id AS hostId,guest_id AS guestId,host_name AS hostName,guest_name AS guestName,host_points AS hostPoints,guest_points AS guestPoints,started_at AS startedAt,ended_at AS endedAt FROM battle_results WHERE host_id=? OR guest_id=? ORDER BY ended_at DESC LIMIT 10').all(user.id,user.id);}
