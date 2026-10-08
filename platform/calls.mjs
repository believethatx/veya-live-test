import {randomBytes} from 'node:crypto';
import {accessFor} from './access.mjs';
import {publicProfile} from './community.mjs';
import {contactBlocked} from './messages.mjs';

const RING_MS=45_000,ACTIVE_MS=30*60_000,PRESENCE_MS=50_000;
export class CallRegistry {
 constructor(media,isInLive=()=>false){this.media=media;this.isInLive=isInLive;this.calls=new Map();this.members=new Map();this.presence=new Map();this.lastInvite=new Map();}
 available(user,enabled){if(!accessFor(user).canHost)throw Error('Host approval is required for calls');if(enabled===true)this.presence.set(user.id,Date.now());else if(enabled===false)this.presence.delete(user.id);else throw Error('Choose whether to take calls');return {available:enabled};}
 status(id){if(this.isInLive(id))return 'live';if(this.members.has(id))return 'busy';return Date.now()-(this.presence.get(id)||0)<PRESENCE_MS?'available':'offline';}
 getByRoom(id){return this.calls.get(id);}
 async state(user){const call=this.members.get(user.id);if(!call)return {call:null,available:this.status(user.id)==='available'};if(this.expired(call)){await this.finish(call);return {call:null,available:false};}
  const partnerId=call.callerId===user.id?call.hostId:call.callerId;
  let partner;try{partner=publicProfile(user,partnerId);}catch{await this.finish(call);return {call:null,available:false};}
  const mine={id:call.id,role:call.callerId===user.id?'caller':'host',status:call.status,partner,createdAt:call.createdAt,startedAt:call.startedAt};
  if(call.status==='active')mine.media=await this.media.token(user,{id:call.id},'call');return {call:mine,available:false};
 }
 expired(call){return Date.now()-(call.startedAt||call.createdAt)>(call.status==='ringing'?RING_MS:ACTIVE_MS);}
 async invite(caller,hostId){if(!this.media.configured)throw Error('Calls are not connected yet');if(caller.id===hostId)throw Error('Choose another host');const host=publicProfile(caller,hostId);if(!host.isHost)throw Error('This person is not an approved host');if(contactBlocked(caller.id,hostId))throw Error('This host is unavailable for calls');if(this.status(hostId)!=='available')throw Error('This host is not available right now');if(this.members.has(caller.id)||this.isInLive(caller.id))throw Error('Leave your current room or call first');if(Date.now()-(this.lastInvite.get(caller.id)||0)<30_000)throw Error('Please wait before requesting another call');
  const call={id:'call-'+randomBytes(12).toString('hex'),callerId:caller.id,hostId,createdAt:Date.now(),startedAt:null,status:'ringing'};
  this.calls.set(call.id,call);this.members.set(caller.id,call);this.members.set(hostId,call);this.lastInvite.set(caller.id,call.createdAt);return this.state(caller);
 }
 async respond(host,id,accept){const call=this.calls.get(id);if(!call||call.hostId!==host.id||call.status!=='ringing'||this.expired(call))throw Error('Call request has expired');if(typeof accept!=='boolean')throw Error('Choose accept or decline');if(!accept){await this.finish(call);return {call:null};}
  if(!accessFor(host).canHost||this.isInLive(host.id)||contactBlocked(host.id,call.callerId)){await this.finish(call);throw Error('Call is no longer available');}
  call.status='active';call.startedAt=Date.now();return this.state(host);
 }
 async end(user,id){const call=this.members.get(user.id);if(!call||call.id!==id)throw Error('Call has ended');await this.finish(call);return {ok:true};}
 async finish(call){if(!this.calls.has(call.id))return;this.calls.delete(call.id);this.members.delete(call.callerId);this.members.delete(call.hostId);if(call.status==='active')try{await this.media.end({id:call.id});}catch{/* Room may already have closed. */}}
 async leaveUser(id){const call=this.members.get(id);if(call)await this.finish(call);this.presence.delete(id);}
}
