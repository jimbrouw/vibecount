import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reminderWebhook,type ReminderWebhookIO,type VerifiedReminderEvent} from './reminder-webhook';
import {signedReminderRequest,verifyReminderSignature} from './reminder-webhook-fixture';
test('real SDK signature validation precedes all reads and writes; bounded raw body',async()=>{
 let effects=0;const io:ReminderWebhookIO={verify:verifyReminderSignature,knownAttempt:async()=>{effects++;return true},retrieve:async()=>{effects++;return {}},record:async()=>{effects++}};
 const event={type:'email.sent',created_at:new Date().toISOString(),data:{email_id:randomUUID(),tags:{vibecount_attempt:randomUUID()}}};
 for(const opts of [{tampered:true},{old:true},{huge:true}])assert.equal((await reminderWebhook(signedReminderRequest(event,opts),io)).status,opts.huge?413:400);
 assert.equal(effects,0);
});
test('verified tagged provider message is persisted; mismatches and outages never acknowledge success',async()=>{
 const attempt=randomUUID(),emailId=randomUUID(),recorded:VerifiedReminderEvent[]=[];
 const event={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:emailId,tags:{vibecount_attempt:attempt}}};
 const email={id:emailId,from:'from@example.invalid',to:['to@example.invalid'],subject:'Review',text:'£120',tags:[{name:'vibecount_attempt',value:attempt}]};
 const io:ReminderWebhookIO={verify:verifyReminderSignature,knownAttempt:async()=>true,retrieve:async()=>email,record:async e=>{recorded.push(e)}};
 assert.equal((await reminderWebhook(signedReminderRequest(event),io)).status,200);assert.equal(recorded.length,1);assert.equal(recorded[0].email.attempt_id,attempt);assert.match(recorded[0].bodyHash,/^[a-f0-9]{64}$/);
 for(const changed of [{...email,id:randomUUID()},{...email,tags:[]},{...email,tags:[...email.tags,...email.tags]},{...email,to:['one','two']},{...email,text:null}])assert.equal((await reminderWebhook(signedReminderRequest(event),{...io,retrieve:async()=>changed})).status,503);
 assert.equal((await reminderWebhook(signedReminderRequest(event),{...io,record:async()=>{throw new Error('PRIVATE_DATABASE_ERROR')}})).status,503);
 assert.equal(recorded.length,1);
 assert.equal((await reminderWebhook(signedReminderRequest({...event,type:'email.opened'}),io)).status,202);
 assert.equal((await reminderWebhook(signedReminderRequest(event),{...io,knownAttempt:async()=>false})).status,202);
 assert.equal(recorded.length,1);
});
