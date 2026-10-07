import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const file=resolve(process.env.DATA_FILE || './data/veya.sqlite');
mkdirSync(dirname(file),{recursive:true});
const db=new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS test_gift_wallets (
 user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0), sent_points INTEGER NOT NULL DEFAULT 0, received_points INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS test_gift_transfers (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 sender_name TEXT NOT NULL, recipient_name TEXT NOT NULL, room_id TEXT NOT NULL,
 gift_id TEXT NOT NULL, points INTEGER NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(sender_id,request_id)
);
CREATE INDEX IF NOT EXISTS test_gift_sender_date ON test_gift_transfers(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS test_gift_recipient_date ON test_gift_transfers(recipient_id,created_at DESC);`);

export const TEST_GIFTS=Object.freeze([
 {id:'heart',name:'Heart',icon:'♥',points:5},
 {id:'star',name:'Star',icon:'✦',points:15},
 {id:'flower',name:'Flower',icon:'✿',points:30},
 {id:'crown',name:'Crown',icon:'♛',points:60},
]);
const giftById=id=>TEST_GIFTS.find(g=>g.id===id);
const ensureWallet=id=>db.prepare('INSERT OR IGNORE INTO test_gift_wallets(user_id,balance) VALUES(?,250)').run(id);
const readWallet=id=>db.prepare('SELECT balance,sent_points AS sentPoints,received_points AS receivedPoints FROM test_gift_wallets WHERE user_id=?').get(id);
const entry=row=>({...row,gift:giftById(row.giftId)?.name || row.giftId});
export function testGiftWallet(user){
 ensureWallet(user.id);
 const recent=db.prepare(`SELECT id,request_id AS requestId,sender_id AS senderId,recipient_id AS recipientId,
 sender_name AS senderName,recipient_name AS recipientName,room_id AS roomId,gift_id AS giftId,
 points,created_at AS createdAt FROM test_gift_transfers
 WHERE sender_id=? OR recipient_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30`).all(user.id,user.id).map(entry);
 return {...readWallet(user.id),testOnly:true,gifts:TEST_GIFTS,recent};
}
export function sendTestGift(sender,recipient,roomId,giftId,requestId){
 const gift=giftById(giftId);
 if(!gift)throw Error('Choose an available gift');
 if(sender.id===recipient.id)throw Error('Choose someone else to gift');
 if(typeof requestId!=='string' || !/^[0-9a-f]{32}$/.test(requestId))throw Error('Invalid gift request');
 db.exec('BEGIN IMMEDIATE');
 try{
  ensureWallet(sender.id);ensureWallet(recipient.id);
  const existing=db.prepare('SELECT id,recipient_id AS recipientId,room_id AS roomId,gift_id AS giftId FROM test_gift_transfers WHERE sender_id=? AND request_id=?').get(sender.id,requestId);
  if(existing){if(existing.recipientId!==recipient.id || existing.roomId!==roomId || existing.giftId!==giftId)throw Error('Gift request already used');const balance=readWallet(sender.id).balance;db.exec('COMMIT');return {duplicate:true,balance};}
  const deducted=db.prepare('UPDATE test_gift_wallets SET balance=balance-?,sent_points=sent_points+? WHERE user_id=? AND balance>=?').run(gift.points,gift.points,sender.id,gift.points);
  if(!deducted.changes)throw Error('Not enough test credits for this gift');
  db.prepare('UPDATE test_gift_wallets SET received_points=received_points+? WHERE user_id=?').run(gift.points,recipient.id);
  const event={id:randomBytes(16).toString('hex'),senderId:sender.id,senderName:sender.displayName,recipientId:recipient.id,recipientName:recipient.displayName,roomId,giftId:gift.id,gift:gift.name,icon:gift.icon,points:gift.points,createdAt:Date.now()};
  db.prepare('INSERT INTO test_gift_transfers VALUES(?,?,?,?,?,?,?,?,?,?)').run(event.id,requestId,sender.id,recipient.id,sender.displayName,recipient.displayName,roomId,gift.id,gift.points,event.createdAt);
  const balance=readWallet(sender.id).balance;db.exec('COMMIT');return {event,balance,duplicate:false};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function testGiftAdminHistory(){return db.prepare(`SELECT id,sender_name AS senderName,recipient_name AS recipientName,
 sender_id AS senderId,recipient_id AS recipientId,room_id AS roomId,gift_id AS giftId,points,created_at AS createdAt
 FROM test_gift_transfers ORDER BY created_at DESC,rowid DESC LIMIT 100`).all().map(entry);}
