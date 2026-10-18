import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {reminderWebhook,type ReminderWebhookIO,type VerifiedReminderEvent} from '../invoices/reminder-webhook';
import {signedReminderRequest,verifyReminderSignature} from '../invoices/reminder-webhook-fixture';
test('signed evidence resolves uncertainty without rewriting outcomes or resending, including webhook-before-response',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID(),client=randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.query("insert into clients(id,user_id,name,email) values($1,$2,'Synthetic','to@example.invalid')",[client,owner]);
 async function createAttempt(){
  await db.exec('reset role');const invoice=randomUUID();await db.query("insert into invoices(id,user_id,client_id,number,description,amount,status,reminder_enabled,next_reminder_at,due_date) values($1,$2,$3,$4,'Fixture',120,'finalised',true,now()-interval '1 day',current_date-1)",[invoice,owner,client,'SYNTHETIC-'+invoice]);
  const initial=(await db.query<{s:string}>('select updated_at::text s from invoices where id=$1',[invoice])).rows[0].s;await db.exec('set role service_role');
  const reminder=(await db.query<{id:string}>("select create_due_reminder($1,$2,$3,12000,'from@example.invalid','to@example.invalid','Review','£120') id",[owner,invoice,initial])).rows[0].id;
  const stamp=(await db.query<{s:string}>('select updated_at::text s from invoice_reminders where id=$1',[reminder])).rows[0].s;
  const claim=(await db.query<{r:{attempt_id:string}}> ('select claim_reminder_send($1,$2,$3,true) r',[owner,reminder,stamp])).rows[0].r;
  return {attempt:claim.attempt_id,invoice,reminder,stamp};
 }
 const first=await createAttempt(),emailId=randomUUID(),occurredAt=new Date().toISOString();
 await db.query("select record_reminder_outcome($1,$2,'unknown',null)",[owner,first.attempt]);
 const email={id:emailId,from:'from@example.invalid',to:['to@example.invalid'],subject:'Review',text:'£120',tags:[{name:'vibecount_attempt',value:first.attempt}]};
 async function record(e:VerifiedReminderEvent){await db.query('select record_reminder_provider_event($1,$2,$3,$4,$5,$6)',[e.attempt,e.eventId,e.type,e.occurredAt,e.bodyHash,e.email])}
 const io:ReminderWebhookIO={verify:verifyReminderSignature,knownAttempt:async()=>true,retrieve:async()=>email,record};
 const event={type:'email.delivered',created_at:occurredAt,data:{email_id:emailId,tags:{vibecount_attempt:first.attempt}}};
 assert.equal((await reminderWebhook(signedReminderRequest(event),io)).status,200);assert.equal((await reminderWebhook(signedReminderRequest(event),io)).status,200);
 const projection=(await db.query<{status:string;provider_delivery_state:string}>('select status,provider_delivery_state from invoice_reminders where id=$1',[first.reminder])).rows[0];assert.equal(projection.status,'sent');assert.equal(projection.provider_delivery_state,'delivered');
 assert.equal((await db.query<{outcome:string}>('select outcome from reminder_send_outcomes where attempt_id=$1',[first.attempt])).rows[0].outcome,'unknown');
 assert.equal((await db.query('select * from reminder_provider_events')).rows.length,1);
 assert.equal((await db.query<{r:{claimed:boolean}}>('select claim_reminder_send($1,$2,$3,true) r',[owner,first.reminder,first.stamp])).rows[0].r.claimed,false);
 assert.equal((await db.query<{enabled:boolean}>('select reminder_enabled enabled from invoices where id=$1',[first.invoice])).rows[0].enabled,false);
 const base:VerifiedReminderEvent={attempt:first.attempt,eventId:'msg_later_sent',type:'email.sent',occurredAt,bodyHash:'a'.repeat(64),email:{...email,attempt_id:first.attempt}};
 await record(base);assert.equal((await db.query<{s:string}>('select provider_delivery_state s from invoice_reminders where id=$1',[first.reminder])).rows[0].s,'delivered');
 await assert.rejects(record({...base,bodyHash:'b'.repeat(64)}),/event changed/);
 await assert.rejects(record({...base,eventId:'msg_bad',email:{...base.email,text:'Changed amount'}}),/does not match/);
 const second=await createAttempt();
 await assert.rejects(record({...base,attempt:second.attempt,eventId:'msg_other_attempt',email:{...base.email,attempt_id:second.attempt}}),/unique constraint/);
 // Webhook first, unknown transport outcome second: verified projection must not regress.
 const secondId=randomUUID();await record({...base,attempt:second.attempt,eventId:'msg_second',type:'email.bounced',email:{...base.email,id:secondId,attempt_id:second.attempt}});
 await db.query("select record_reminder_outcome($1,$2,'unknown',null)",[owner,second.attempt]);
 assert.equal((await db.query<{s:string}>('select provider_delivery_state s from invoice_reminders where id=$1',[second.reminder])).rows[0].s,'needs_attention');
 assert.equal((await db.query<{s:string}>('select status s from invoice_reminders where id=$1',[second.reminder])).rows[0].s,'sent');
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from reminder_provider_events')).rows.length,0);
 await assert.rejects(record(base),/permission denied/);await assert.rejects(db.query('delete from reminder_provider_receipts'),/permission denied/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await db.query('select * from reminder_provider_events')).rows.length,3);await assert.rejects(db.query("update reminder_provider_events set event_type='email.sent'"),/permission denied/);
});
