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
CREATE INDEX IF NOT EXISTS test_gift_recipient_date ON test_gift_transfers(recipient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS test_gift_catalog (gift_id TEXT PRIMARY KEY, points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 250), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
CREATE TABLE IF NOT EXISTS test_gift_catalog_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, gift_id TEXT NOT NULL, points INTEGER NOT NULL, enabled INTEGER NOT NULL, changed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS test_gift_grants (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 10000), reason TEXT NOT NULL, created_at INTEGER NOT NULL);`);

export const TEST_GIFTS=Object.freeze([
 {id:'heart',name:'Heart',icon:'♥',points:5,codepoint:'2764_fe0f'},
 {id:'rose',name:'Rose',icon:'🌹',points:10,codepoint:'1f339'},
 {id:'tulip',name:'Tulip',icon:'🌷',points:12,codepoint:'1f337'},
 {id:'balloon',name:'Balloon',icon:'🎈',points:12,codepoint:'1f388'},
 {id:'star',name:'Star',icon:'✦',points:15,codepoint:'2b50'},
 {id:'sparkles',name:'Sparkles',icon:'✨',points:15,codepoint:'2728'},
 {id:'butterfly',name:'Butterfly',icon:'🦋',points:20,codepoint:'1f98b'},
 {id:'clover',name:'Lucky Clover',icon:'🍀',points:25,codepoint:'1f340'},
 {id:'fire',name:'Fire',icon:'🔥',points:25,codepoint:'1f525'},
 {id:'flower',name:'Flower',icon:'✿',points:30,codepoint:'1f33c'},
 {id:'rainbow',name:'Rainbow',icon:'🌈',points:30,codepoint:'1f308'},
 {id:'giftbox',name:'Gift Box',icon:'🎁',points:35,codepoint:'1f381'},
 {id:'bouquet',name:'Bouquet',icon:'💐',points:40,codepoint:'1f490'},
 {id:'cake',name:'Cake',icon:'🎂',points:45,codepoint:'1f382'},
 {id:'party',name:'Party Popper',icon:'🎉',points:45,codepoint:'1f389'},
 {id:'champagne',name:'Champagne',icon:'🍾',points:50,codepoint:'1f37e'},
 {id:'coin',name:'Coin',icon:'🪙',points:55,codepoint:'1fa99'},
 {id:'crown',name:'Crown',icon:'♛',points:60,codepoint:'1f451'},
 {id:'gem',name:'Gem',icon:'💎',points:70,codepoint:'1f48e'},
 {id:'ring',name:'Ring',icon:'💍',points:75,codepoint:'1f48d'},
 {id:'trophy',name:'Trophy',icon:'🏆',points:90,codepoint:'1f3c6'},
 {id:'fireworks',name:'Fireworks',icon:'🎆',points:100,codepoint:'1f386'},
 {id:'rocket',name:'Rocket',icon:'🚀',points:120,codepoint:'1f680'},
 {id:'unicorn',name:'Unicorn',icon:'🦄',points:140,codepoint:'1f984'},
 {id:'car',name:'Car',icon:'🚗',points:180,codepoint:'1f697'},
 {id:'snow_leopard',name:'Snow Leopard',icon:'🐆',points:110,scene:'snow_leopard'},
 {id:'dance_party',name:'Dance Party',icon:'🎶',points:80,scene:'dance_party'},
 {id:'football',name:'Football',icon:'⚽',points:85,scene:'football'},
 {id:'veya_popper',name:'Celebration Popper',icon:'🎉',points:65,scene:'veya_popper'},
 {id:'phoenix',name:'Phoenix',icon:'🔥',points:160,scene:'phoenix'},
 {id:'moon_carriage',name:'Moon Carriage',icon:'🌙',points:200,scene:'moon_carriage'},
 {id:'crystal_rose',name:'Crystal Rose',icon:'🌹',points:35,scene:'crystal_rose',atlas:'sparkle'},
 {id:'golden_butterfly',name:'Golden Butterfly',icon:'🦋',points:45,scene:'golden_butterfly',atlas:'sparkle'},
 {id:'magic_lantern',name:'Magic Lantern',icon:'🏮',points:50,scene:'magic_lantern',atlas:'sparkle'},
 {id:'treasure_chest',name:'Treasure Chest',icon:'💎',points:95,scene:'treasure_chest',atlas:'sparkle'},
 {id:'moon_swing',name:'Moon Swing',icon:'🌙',points:75,scene:'moon_swing',atlas:'sparkle'},
 {id:'heart_comet',name:'Heart Comet',icon:'💜',points:85,scene:'heart_comet',atlas:'sparkle'},
 {id:'crystal_stag',name:'Crystal Stag',icon:'✦',points:130,scene:'crystal_stag',atlas:'premium'},
 {id:'neon_supercar',name:'Neon Supercar',icon:'🏎️',points:145,scene:'neon_supercar',atlas:'premium'},
 {id:'sea_dragon',name:'Sea Dragon',icon:'🐉',points:155,scene:'sea_dragon',atlas:'premium'},
 {id:'grand_piano',name:'Grand Piano',icon:'🎹',points:120,scene:'grand_piano',atlas:'premium'},
 {id:'sky_airship',name:'Sky Airship',icon:'✦',points:175,scene:'sky_airship',atlas:'premium'},
 {id:'cosmic_whale',name:'Cosmic Whale',icon:'🐋',points:210,scene:'cosmic_whale',atlas:'premium'},
 ...[
  ['sa','Saudi Arabia','🇸🇦'],['ae','United Arab Emirates','🇦🇪'],['kw','Kuwait','🇰🇼'],['qa','Qatar','🇶🇦'],
  ['eg','Egypt','🇪🇬'],['ps','Palestine','🇵🇸'],['iq','Iraq','🇮🇶'],['lb','Lebanon','🇱🇧']
 ].map(([flag,name,icon])=>({id:`flag_${flag}`,name:`${name} Flag`,icon,points:25,flag})),
]);
const giftById=id=>TEST_GIFTS.find(g=>g.id===id);
const configuredGift=gift=>{const setting=db.prepare('SELECT points,enabled FROM test_gift_catalog WHERE gift_id=?').get(gift.id);return {...gift,points:setting?.points??gift.points,enabled:setting?.enabled!==0,category:gift.flag?'Flags':gift.scene?'Veya':'Classic'};};
export const giftCatalog=(includeDisabled=false)=>TEST_GIFTS.map(configuredGift).filter(g=>includeDisabled||g.enabled);
export function updateGiftCatalog(actor,id,points,enabled){
 if(!giftById(id))throw Error('Gift not found');
 if(!Number.isInteger(points)||points<1||points>250)throw Error('Use 1 to 250 test credits');
 if(typeof enabled!=='boolean')throw Error('Choose whether this gift is available');
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('INSERT INTO test_gift_catalog(gift_id,points,enabled) VALUES(?,?,?) ON CONFLICT(gift_id) DO UPDATE SET points=excluded.points,enabled=excluded.enabled').run(id,points,enabled?1:0);
  db.prepare('INSERT INTO test_gift_catalog_audit VALUES(?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),actor.id,id,points,enabled?1:0,Date.now());
  db.exec('COMMIT');return configuredGift(giftById(id));
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export const giftCatalogAudit=()=>db.prepare('SELECT actor_id AS actorId,gift_id AS giftId,points,enabled,changed_at AS changedAt FROM test_gift_catalog_audit ORDER BY changed_at DESC LIMIT 30').all();
export const testGiftGrantHistory=()=>db.prepare('SELECT id,actor_id AS actorId,user_id AS userId,points,reason,created_at AS createdAt FROM test_gift_grants ORDER BY created_at DESC,rowid DESC LIMIT 50').all();
const ensureWallet=id=>db.prepare('INSERT OR IGNORE INTO test_gift_wallets(user_id,balance) VALUES(?,250)').run(id);
const readWallet=id=>db.prepare('SELECT balance,sent_points AS sentPoints,received_points AS receivedPoints FROM test_gift_wallets WHERE user_id=?').get(id);
export function grantTestCredits(actor,userId,points,reason){
 if(typeof userId!=='string'||!/^[0-9a-f-]{16,64}$/.test(userId))throw Error('Choose an account');
 if(!Number.isInteger(points)||points<1||points>10000)throw Error('Grant 1 to 10,000 test credits');
 if(typeof reason!=='string'||!reason.trim()||reason.trim().length>200)throw Error('Add a reason under 200 characters');
 db.exec('BEGIN IMMEDIATE');try{
  ensureWallet(userId);
  const updated=db.prepare('UPDATE test_gift_wallets SET balance=balance+? WHERE user_id=? AND balance+?<=100000').run(points,userId,points);
  if(!updated.changes)throw Error('Wallet limit is 100,000 test credits');
  db.prepare('INSERT INTO test_gift_grants VALUES(?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),actor.id,userId,points,reason.trim(),Date.now());
  const balance=readWallet(userId).balance;db.exec('COMMIT');return {balance,testOnly:true};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
const entry=row=>({...row,gift:giftById(row.giftId)?.name || row.giftId,icon:giftById(row.giftId)?.icon || '✦',codepoint:giftById(row.giftId)?.codepoint || null,scene:giftById(row.giftId)?.scene || null,atlas:giftById(row.giftId)?.atlas || null,flag:giftById(row.giftId)?.flag || null});
export function testGiftWallet(user){
 ensureWallet(user.id);
 const recent=db.prepare(`SELECT id,request_id AS requestId,sender_id AS senderId,recipient_id AS recipientId,
 sender_name AS senderName,recipient_name AS recipientName,room_id AS roomId,gift_id AS giftId,
 points,created_at AS createdAt FROM test_gift_transfers
 WHERE sender_id=? OR recipient_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30`).all(user.id,user.id).map(entry);
 return {...readWallet(user.id),testOnly:true,gifts:giftCatalog(),recent};
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
  const current=configuredGift(gift);if(!current.enabled)throw Error('This gift is no longer available');
  const deducted=db.prepare('UPDATE test_gift_wallets SET balance=balance-?,sent_points=sent_points+? WHERE user_id=? AND balance>=?').run(current.points,current.points,sender.id,current.points);
  if(!deducted.changes)throw Error('Not enough test credits for this gift');
  db.prepare('UPDATE test_gift_wallets SET received_points=received_points+? WHERE user_id=?').run(current.points,recipient.id);
  const event={id:randomBytes(16).toString('hex'),senderId:sender.id,senderName:sender.displayName,recipientId:recipient.id,recipientName:recipient.displayName,roomId,giftId:gift.id,gift:gift.name,icon:gift.icon,codepoint:gift.codepoint||null,scene:gift.scene||null,atlas:gift.atlas||null,flag:gift.flag||null,points:current.points,createdAt:Date.now()};
  db.prepare('INSERT INTO test_gift_transfers VALUES(?,?,?,?,?,?,?,?,?,?)').run(event.id,requestId,sender.id,recipient.id,sender.displayName,recipient.displayName,roomId,gift.id,current.points,event.createdAt);
  const balance=readWallet(sender.id).balance;db.exec('COMMIT');return {event,balance,duplicate:false};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function testGiftAdminHistory(){return db.prepare(`SELECT id,sender_name AS senderName,recipient_name AS recipientName,
 sender_id AS senderId,recipient_id AS recipientId,room_id AS roomId,gift_id AS giftId,points,created_at AS createdAt
 FROM test_gift_transfers ORDER BY created_at DESC,rowid DESC LIMIT 100`).all().map(entry);}
