import assert from 'node:assert/strict';
import test from 'node:test';
import {deliverClaimedReminder,type ReminderClaim} from './reminder-delivery';
const claim:ReminderClaim={claimed:true,attempt_id:'attempt',provider_key:'stable-key',payload:{from:'from@example.invalid',to:'to@example.invalid',subject:'Reminder',text:'Reviewed amount'}};
test('only a new durable claim calls the provider and successful acceptance is recorded',async()=>{
 const calls:unknown[]=[];
 const io={send:async(p:unknown,key:string)=>{calls.push({p,key});return {id:'accepted-id'}},record:async(...args:unknown[])=>{calls.push(args)}};
 assert.equal(await deliverClaimedReminder({claimed:false,status:'sending'},io),'already_processed');assert.equal(calls.length,0);
 assert.equal(await deliverClaimedReminder(claim,io),'accepted');assert.deepEqual(calls,[{p:claim.payload,key:'stable-key'},['attempt','accepted','accepted-id']]);
});
test('transport throw or missing ID remains unknown and never retries',async()=>{
 for(const fail of [true,false]){
  let sends=0;const outcomes:unknown[]=[];
  assert.equal(await deliverClaimedReminder(claim,{send:async()=>{sends++;if(fail)throw new Error('timeout');return {}},record:async(...args)=>{outcomes.push(args)}}),'unknown');
  assert.equal(sends,1);assert.deepEqual(outcomes,[['attempt','unknown',null]]);
 }
});
test('accepted provider response with failed outcome write cannot report success',async()=>{
 let sends=0;
 assert.equal(await deliverClaimedReminder(claim,{send:async()=>{sends++;return {id:'accepted-id'}},record:async()=>{throw new Error('database unavailable')}}),'unknown');assert.equal(sends,1);
});
