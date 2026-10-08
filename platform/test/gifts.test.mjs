import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'veya-gifts-'));
process.env.DATA_FILE=join(directory,'test.sqlite');
const {register}=await import('../auth.mjs');
const {sendTestGift,testGiftWallet,testGiftAdminHistory,TEST_GIFTS,giftCatalog,updateGiftCatalog,grantTestCredits,testGiftGrantHistory}=await import('../gifts.mjs');
test('catalog includes illustrated, flag and classic gifts with distinct IDs',()=>{
 assert.equal(TEST_GIFTS.length,51);
 assert.equal(new Set(TEST_GIFTS.map(g=>g.id)).size,51);
 assert.equal(TEST_GIFTS.filter(g=>g.scene).length,18);
 assert.equal(TEST_GIFTS.filter(g=>g.flag).length,8);
 for(const gift of TEST_GIFTS){assert.ok(gift.codepoint||gift.scene||gift.flag);if(gift.codepoint)assert.match(gift.codepoint,/^[0-9a-f]+(?:_[0-9a-f]+)*$/);assert.ok(gift.points>0 && gift.points<=250);}
});
const sender=register({email:'sender@example.test',displayName:'Sender',password:'a long test password',adult:true});
const recipient=register({email:'receiver@example.test',displayName:'Receiver',password:'a long test password',adult:true});
test('test gift balances are atomic, limited, idempotent and have no money fields',()=>{
 const id='a'.repeat(32),first=sendTestGift(sender,recipient,'room-one','heart',id);
 assert.equal(first.balance,245);assert.equal(first.event.points,5);
 assert.equal(sendTestGift(sender,recipient,'room-one','heart',id).duplicate,true);
 assert.equal(testGiftWallet(sender).balance,245);assert.equal(testGiftWallet(recipient).receivedPoints,5);
 assert.throws(()=>sendTestGift(sender,recipient,'room-one','crown',id),/already used/);
 assert.throws(()=>sendTestGift(sender,sender,'room-one','heart','b'.repeat(32)),/someone else/);
 assert.throws(()=>sendTestGift(sender,recipient,'room-one','unknown','b'.repeat(32)),/available gift/);
 for(let n=0;n<4;n++)sendTestGift(sender,recipient,'room-one','crown',n.toString(16).padStart(32,'0'));
 assert.equal(testGiftWallet(sender).balance,5);
 assert.throws(()=>sendTestGift(sender,recipient,'room-one','star','c'.repeat(32)),/Not enough test credits/);
 assert.equal(testGiftWallet(sender).balance,5);
 assert.equal(testGiftWallet(recipient).receivedPoints,245);
 assert.equal(testGiftAdminHistory().length,5);
 assert.equal(testGiftWallet(sender).testOnly,true);
 assert.equal('cash' in testGiftWallet(recipient),false);
});
test('Veya scene gift preserves its animation identity in events and history',()=>{
 const other=register({email:'scene@example.test',displayName:'Scene',password:'a long test password',adult:true});
 const sent=sendTestGift(other,recipient,'room-two','phoenix','d'.repeat(32));
 assert.equal(sent.event.scene,'phoenix');
 assert.equal(sent.event.points,160);
 assert.equal(testGiftWallet(other).recent[0].scene,'phoenix');
 assert.equal(testGiftWallet(other).balance,90);
});
test('admin availability and price apply to new sends while history keeps its price',()=>{
 const actor={id:'admin'},other=register({email:'flag@example.test',displayName:'Flag',password:'a long test password',adult:true});
 const original=sendTestGift(other,recipient,'room-flags','flag_sa','e'.repeat(32));assert.equal(original.event.points,25);assert.equal(original.event.flag,'sa');
 updateGiftCatalog(actor,'flag_sa',30,false);
 assert.equal(giftCatalog().some(g=>g.id==='flag_sa'),false);
 assert.throws(()=>sendTestGift(other,recipient,'room-flags','flag_sa','f'.repeat(32)),/no longer available/);
 assert.equal(sendTestGift(other,recipient,'room-flags','flag_sa','e'.repeat(32)).duplicate,true);
 updateGiftCatalog(actor,'flag_sa',18,true);
 const next=sendTestGift(other,recipient,'room-flags','flag_sa','1'.repeat(32));assert.equal(next.event.points,18);
 assert.equal(testGiftWallet(other).recent.find(e=>e.id===original.event.id).points,25);
 assert.throws(()=>updateGiftCatalog(actor,'flag_sa',0,true),/1 to 250/);
 assert.throws(()=>updateGiftCatalog(actor,'unknown',25,true),/not found/);
});
test('admin test-credit grants increase only wallet balance and leave an audit trail',()=>{
 const actor={id:'admin'};assert.throws(()=>grantTestCredits(actor,sender.id,0,'Test'),/1 to 10,000/);
 assert.throws(()=>grantTestCredits(actor,sender.id,250,''),/reason/);
 const result=grantTestCredits(actor,sender.id,250,'Continue testing gifts');assert.equal(result.balance,255);assert.equal(result.testOnly,true);
 assert.equal(testGiftWallet(sender).sentPoints,245);assert.equal(testGiftWallet(sender).receivedPoints,0);
 assert.deepEqual(testGiftGrantHistory()[0].reason,'Continue testing gifts');
 for(let n=0;n<9;n++)grantTestCredits(actor,sender.id,10000,'Test capacity');
 assert.throws(()=>grantTestCredits(actor,sender.id,10000,'Over cap'),/Wallet limit/);
 assert.equal(testGiftGrantHistory().length,10);
});
test.after(()=>rmSync(directory,{recursive:true,force:true}));
