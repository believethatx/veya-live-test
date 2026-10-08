import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {publicProfile} from './community.mjs';

const db=new DatabaseSync(resolve(process.env.DATA_FILE || './data/veya.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS direct_messages (id TEXT PRIMARY KEY,sender_id TEXT NOT NULL,recipient_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS direct_messages_sender ON direct_messages(sender_id,recipient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_recipient ON direct_messages(recipient_id,sender_id,created_at DESC);
CREATE TABLE IF NOT EXISTS message_blocks (owner_id TEXT NOT NULL,peer_id TEXT NOT NULL,PRIMARY KEY(owner_id,peer_id));
CREATE TABLE IF NOT EXISTS message_archives (owner_id TEXT NOT NULL,peer_id TEXT NOT NULL,hidden_at INTEGER NOT NULL,PRIMARY KEY(owner_id,peer_id));`);

const blocked=(a,b)=>Boolean(db.prepare('SELECT 1 FROM message_blocks WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?)').get(a,b,b,a));
export const contactBlocked=blocked;
const archived=(a,b)=>db.prepare('SELECT hidden_at FROM message_archives WHERE owner_id=? AND peer_id=?').get(a,b)?.hidden_at || 0;
function peer(viewer,id){if(id===viewer.id)throw Error('Choose another person');return publicProfile(viewer,String(id));}

export function conversations(viewer){
 const rows=db.prepare(`SELECT CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END AS peerId,MAX(created_at) AS lastAt FROM direct_messages WHERE sender_id=? OR recipient_id=? GROUP BY peerId ORDER BY lastAt DESC LIMIT 100`).all(viewer.id,viewer.id,viewer.id);
 return rows.filter(row=>row.lastAt>archived(viewer.id,row.peerId)).map(row=>{
  try{
   const profile=peer(viewer,row.peerId);
   const last=db.prepare('SELECT body,sender_id AS senderId,created_at AS createdAt FROM direct_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND created_at>? ORDER BY created_at DESC,id DESC LIMIT 1').get(viewer.id,row.peerId,row.peerId,viewer.id,archived(viewer.id,row.peerId));
   const unread=db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE recipient_id=? AND sender_id=? AND seen=0 AND created_at>?').get(viewer.id,row.peerId,archived(viewer.id,row.peerId)).n;
   return {profile,last,unread,blocked:blocked(viewer.id,row.peerId)};
  }catch{return null;}
 }).filter(Boolean);
}
export function conversation(viewer,id){
 const profile=peer(viewer,id),since=archived(viewer.id,id);
 db.prepare('UPDATE direct_messages SET seen=1 WHERE recipient_id=? AND sender_id=? AND created_at>?').run(viewer.id,id,since);
 const items=db.prepare('SELECT id,sender_id AS senderId,recipient_id AS recipientId,body,created_at AS createdAt FROM (SELECT * FROM direct_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND created_at>? ORDER BY created_at DESC,id DESC LIMIT 100) ORDER BY created_at,id').all(viewer.id,id,id,viewer.id,since);
 return {profile,items,blocked:blocked(viewer.id,id),blockedByMe:Boolean(db.prepare('SELECT 1 FROM message_blocks WHERE owner_id=? AND peer_id=?').get(viewer.id,id))};
}
export function sendMessage(viewer,id,body){
 peer(viewer,id);
 if(blocked(viewer.id,id))throw Error('Messages are unavailable for this conversation');
 if(typeof body!=='string'||!body.trim()||body.trim().length>1000)throw Error('Write a message of up to 1,000 characters');
 const relation=db.prepare('SELECT 1 FROM follows WHERE (follower_id=? AND target_id=?) OR (follower_id=? AND target_id=?)').get(viewer.id,id,id,viewer.id);
 if(!relation)throw Error('Follow this person before messaging them');
 const now=Date.now();
 const recent=db.prepare('SELECT created_at FROM direct_messages WHERE sender_id=? ORDER BY created_at DESC LIMIT 1').get(viewer.id);
 if(recent && now-recent.created_at<2000)throw Error('Please wait a moment before sending another message');
 const daily=db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE sender_id=? AND created_at>?').get(viewer.id,now-86400000).n;
 if(daily>=100)throw Error('Daily message limit reached');
 const item={id:randomBytes(16).toString('hex'),senderId:viewer.id,recipientId:id,body:body.trim(),createdAt:now};
 db.prepare('INSERT INTO direct_messages VALUES(?,?,?,?,?,0)').run(item.id,viewer.id,id,item.body,now);
 db.prepare('DELETE FROM message_archives WHERE owner_id=? AND peer_id=?').run(viewer.id,id);
 return item;
}
export function blockMessages(viewer,id,enabled){peer(viewer,id);if(typeof enabled!=='boolean')throw Error('Choose block or unblock');if(enabled)db.prepare('INSERT OR IGNORE INTO message_blocks VALUES(?,?)').run(viewer.id,id);else db.prepare('DELETE FROM message_blocks WHERE owner_id=? AND peer_id=?').run(viewer.id,id);return {blocked:enabled};}
export function removeConversation(viewer,id){peer(viewer,id);db.prepare('INSERT INTO message_archives VALUES(?,?,?) ON CONFLICT(owner_id,peer_id) DO UPDATE SET hidden_at=excluded.hidden_at').run(viewer.id,id,Date.now());return {ok:true};}
export function reportableMessage(viewer,id){
 if(typeof id!=='string'||!/^[0-9a-f]{32}$/.test(id))throw Error('Message unavailable');
 const item=db.prepare('SELECT m.id,m.sender_id AS senderId,u.display_name AS senderName,m.body FROM direct_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=? AND m.recipient_id=?').get(id,viewer.id);
 if(!item)throw Error('You can only report a message sent to you');
 return item;
}
