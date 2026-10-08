import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'veya-battles-'));process.env.DATA_FILE=join(directory,'test.sqlite');
const {recordBattle,ownBattles}=await import('../battles.mjs');
test('finished guest battles persist once for both hosts without becoming money',()=>{
 const room={id:'room-one'},state={active:false,hostId:'host',guestId:'guest',hostName:'Host',guestName:'Guest',hostPoints:5,guestPoints:15,startedAt:1000};
 recordBattle(room,{...state,active:true});assert.deepEqual(ownBattles({id:'host'}),[]);
 recordBattle(room,state);recordBattle(room,state);
 const host=ownBattles({id:'host'}),guest=ownBattles({id:'guest'});
 assert.equal(host.length,1);assert.deepEqual(host,guest);assert.equal(host[0].guestPoints,15);
 assert.equal('payout' in host[0],false);assert.deepEqual(ownBattles({id:'stranger'}),[]);
});
process.on('exit',()=>rmSync(directory,{recursive:true,force:true}));
