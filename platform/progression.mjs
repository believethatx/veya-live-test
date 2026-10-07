import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {accessFor,hasPermission,isOwner} from './access.mjs';
import './community.mjs';
import './gifts.mjs';

const file=resolve(process.env.DATA_FILE || './data/veya.sqlite');
mkdirSync(dirname(file),{recursive:true});
const db=new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS progression_badge_overrides (
 user_id TEXT NOT NULL, badge_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('award','revoke','auto')),
 actor_id TEXT NOT NULL, changed_at INTEGER NOT NULL, PRIMARY KEY(user_id,badge_id)
);
CREATE TABLE IF NOT EXISTS progression_rank_exclusions (
 user_id TEXT PRIMARY KEY, excluded INTEGER NOT NULL CHECK(excluded IN (0,1)), actor_id TEXT NOT NULL, changed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progression_xp_adjustments (
 user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','host')),
 amount INTEGER NOT NULL, actor_id TEXT NOT NULL, changed_at INTEGER NOT NULL, PRIMARY KEY(user_id,role)
);
CREATE TABLE IF NOT EXISTS progression_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, value TEXT NOT NULL, changed_at INTEGER NOT NULL
);`);

export const BADGES=Object.freeze([
 {id:'welcome',icon:'✦',name:'First steps',description:'Complete your profile',metric:'profile',target:1},
 {id:'connector',icon:'♡',name:'Connector',description:'Reach 5 followers',metric:'followers',target:5},
 {id:'community_star',icon:'✧',name:'Community star',description:'Reach 25 followers',metric:'followers',target:25},
 {id:'storyteller',icon:'▣',name:'Storyteller',description:'Share your first Moment',metric:'moments',target:1},
 {id:'creator',icon:'◈',name:'Creator',description:'Share 10 Moments',metric:'moments',target:10},
 {id:'first_gift',icon:'◇',name:'Kind gesture',description:'Send your first test gift',metric:'giftsSent',target:1},
 {id:'supporter',icon:'❖',name:'Supporter',description:'Send 10 test gifts',metric:'giftsSent',target:10},
 {id:'first_live',icon:'◉',name:'On air',description:'Complete your first live',metric:'lives',target:1},
 {id:'live_hour',icon:'☼',name:'One hour live',description:'Stream for 1 hour total',metric:'liveMinutes',target:60},
 {id:'regular_host',icon:'♛',name:'Regular host',description:'Stream for 10 hours total',metric:'liveMinutes',target:600},
 {id:'host_community',icon:'♕',name:'Host community',description:'Reach 25 followers as a host',metric:'hostFollowers',target:25}
]);

function weekStart(now){const midnight=Math.floor(now/86400000)*86400000;return midnight-((new Date(midnight).getUTCDay()+6)%7)*86400000;}
function counts(id){
 const followers=db.prepare('SELECT COUNT(*) AS n FROM follows WHERE target_id=?').get(id).n;
 const moments=db.prepare('SELECT COUNT(*) AS n FROM moments WHERE user_id=?').get(id).n;
 const giftsSent=db.prepare('SELECT COUNT(*) AS n FROM test_gift_transfers WHERE sender_id=?').get(id).n;
 const giftsReceived=db.prepare('SELECT COUNT(*) AS n FROM test_gift_transfers WHERE recipient_id=?').get(id).n;
 const sentPoints=db.prepare('SELECT COALESCE(SUM(points),0) AS n FROM test_gift_transfers WHERE sender_id=?').get(id).n;
 const lives=db.prepare('SELECT COUNT(*) AS n FROM host_sessions WHERE user_id=? AND ended_at IS NOT NULL').get(id).n;
 const liveMs=db.prepare('SELECT COALESCE(SUM(MAX(last_seen-started_at,0)),0) AS n FROM host_sessions WHERE user_id=?').get(id).n;
 const liveMinutes=Math.floor(liveMs/60000);
 return {profile:1,followers,moments,giftsSent,giftsReceived,sentPoints,lives,liveMinutes};
}
function level(xp){const value=Math.max(0,Math.floor(xp));const number=Math.min(50,1+Math.floor(Math.sqrt(value/100)));const start=100*(number-1)**2,next=100*number**2;return {number,xp:value,start,next:number===50?null:next,progress:number===50?100:Math.min(100,Math.floor((value-start)/(next-start)*100))};}
export function progression(id){
 const c=counts(id),a=accessFor({id});
 const adjustments=Object.fromEntries(db.prepare('SELECT role,amount FROM progression_xp_adjustments WHERE user_id=?').all(id).map(x=>[x.role,x.amount]));
 const viewer=level(c.followers*15+c.moments*25+c.giftsSent*10+(adjustments.viewer||0));
 const host=level(c.liveMinutes*2+c.lives*30+c.followers*5+(adjustments.host||0));
 const override=new Map(db.prepare('SELECT badge_id,state FROM progression_badge_overrides WHERE user_id=?').all(id).map(x=>[x.badge_id,x.state]));
 const badges=BADGES.map(b=>{const value=b.metric==='hostFollowers'?(a.canHost?c.followers:0):c[b.metric];const state=override.get(b.id)||'auto';return {...b,value,earned:state==='award'||(state==='auto'&&value>=b.target),manual:state==='award',revoked:state==='revoke'};});
 return {viewer,host: a.canHost||c.lives ? host:null,badges,counts:c,adjustments:{viewer:adjustments.viewer||0,host:adjustments.host||0},rankExcluded:!!db.prepare('SELECT excluded FROM progression_rank_exclusions WHERE user_id=?').get(id)?.excluded};
}
export function leaderboard(viewer,board='hosts',period='week'){
 if(!['hosts','community','supporters'].includes(board)||!['week','all'].includes(period))throw Error('Choose a ranking and period');
 const start=period==='week'?weekStart(Date.now()):0,now=Date.now();
 const users=db.prepare('SELECT u.id,u.display_name AS displayName,p.avatar,p.country FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.adult_ack=1 AND p.completed=1 AND p.country<>\'\' AND p.profile_removed=0 AND NOT EXISTS(SELECT 1 FROM progression_rank_exclusions e WHERE e.user_id=u.id AND e.excluded=1)').all();
 const entries=[];
 for(const u of users){
  const a=accessFor({id:u.id});if(!a.accessAllowed||a.blocked||(board==='hosts'&&!a.canHost))continue;
  let score=0;
  if(board==='hosts'){
   const sessions=db.prepare('SELECT started_at,last_seen FROM host_sessions WHERE user_id=? AND last_seen>? AND started_at<?').all(u.id,start,now);
   score=Math.floor(sessions.reduce((sum,s)=>sum+Math.max(0,Math.min(s.last_seen,now)-Math.max(s.started_at,start)),0)/60000);
  }else if(board==='community'){
   const moments=db.prepare('SELECT COUNT(*) AS n FROM moments WHERE user_id=? AND created_at>=?').get(u.id,start).n;
   const newFollowers=db.prepare('SELECT COUNT(*) AS n FROM follows WHERE target_id=? AND created_at>=?').get(u.id,start).n;
   score=moments*25+newFollowers*15;
  }else score=db.prepare('SELECT COALESCE(SUM(points),0) AS n FROM test_gift_transfers WHERE sender_id=? AND created_at>=?').get(u.id,start).n;
  if(score>0)entries.push({...u,score});
 }
 entries.sort((a,b)=>b.score-a.score||a.displayName.localeCompare(b.displayName)||a.id.localeCompare(b.id));
 return {board,period,weekStart:weekStart(now),unit:board==='hosts'?'live minutes':board==='community'?'activity XP':'test credits sent',entries:entries.slice(0,30).map((x,i)=>({...x,rank:i+1})),myRank:entries.findIndex(x=>x.id===viewer.id)+1||null};
}
export function updateProgression(actor,{userId,badgeId,state,rankExcluded,role,adjustment}){
 if(!hasPermission(actor,'progression'))throw Error('Progression management access required');
 if(!db.prepare('SELECT id FROM users WHERE id=?').get(userId))throw Error('Account not found');
 if(isOwner({id:userId})&&!isOwner(actor))throw Error('Owner profile is protected');
 if(badgeId){if(!BADGES.some(b=>b.id===badgeId)||!['award','revoke','auto'].includes(state))throw Error('Choose a badge and action');
  db.prepare('INSERT INTO progression_badge_overrides VALUES(?,?,?,?,?) ON CONFLICT(user_id,badge_id) DO UPDATE SET state=excluded.state,actor_id=excluded.actor_id,changed_at=excluded.changed_at').run(userId,badgeId,state,actor.id,Date.now());
  db.prepare('INSERT INTO progression_audit VALUES(?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),actor.id,userId,'badge',badgeId+':'+state,Date.now());
 }else if(typeof rankExcluded==='boolean'){
  db.prepare('INSERT INTO progression_rank_exclusions VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET excluded=excluded.excluded,actor_id=excluded.actor_id,changed_at=excluded.changed_at').run(userId,rankExcluded?1:0,actor.id,Date.now());
  db.prepare('INSERT INTO progression_audit VALUES(?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),actor.id,userId,'ranking',rankExcluded?'excluded':'included',Date.now());
 }else if(role){
  if(!['viewer','host'].includes(role)||!Number.isSafeInteger(adjustment)||adjustment< -100000||adjustment>100000)throw Error('Use a whole XP correction between -100000 and 100000');
  db.prepare('INSERT INTO progression_xp_adjustments VALUES(?,?,?,?,?) ON CONFLICT(user_id,role) DO UPDATE SET amount=excluded.amount,actor_id=excluded.actor_id,changed_at=excluded.changed_at').run(userId,role,adjustment,actor.id,Date.now());
  db.prepare('INSERT INTO progression_audit VALUES(?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),actor.id,userId,'xp',role+':'+adjustment,Date.now());
 }else throw Error('Choose a badge, XP or ranking action');
 return progression(userId);
}
export const progressionAudit=actor=>{if(!hasPermission(actor,'progression'))throw Error('Progression management access required');return db.prepare('SELECT actor_id AS actorId,user_id AS userId,action,value,changed_at AS changedAt FROM progression_audit ORDER BY changed_at DESC LIMIT 30').all();};
export const progressionUsers=actor=>{if(!hasPermission(actor,'progression'))throw Error('Progression management access required');return db.prepare('SELECT id,display_name AS displayName FROM users ORDER BY created_at DESC LIMIT 200').all();};
