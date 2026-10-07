import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'veya-gifts-'));
process.env.DATA_FILE=join(directory,'test.sqlite');
const {register}=await import('../auth.mjs');
const {sendTestGift,testGiftWallet,testGiftAdminHistory,TEST_GIFTS}=await import('../gifts.mjs');
test('gift collection has 25 distinct animations within the test balance',()=>{
 assert.equal(TEST_GIFTS.length,25);
 assert.equal(new Set(TEST_GIFTS.map(g=>g.id)).size,25);
 assert.equal(new Set(TEST_GIFTS.map(g=>g.codepoint)).size,25);
 for(const gift of TEST_GIFTS){assert.match(gift.codepoint,/^[0-9a-f]+(?:_[0-9a-f]+)*$/);assert.ok(gift.points>0 && gift.points<=250);}
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
test.after(()=>rmSync(directory,{recursive:true,force:true}));
