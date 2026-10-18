import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
test('durable reminder draft/claim/outcome, ownership and rollback',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID(),client=randomUUID(),invoice=randomUUID();
 await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query("insert into clients(id,user_id,name,email) values($1,$2,'Synthetic','to@example.invalid')",[client,owner]);
 await db.query("insert into invoices(id,user_id,client_id,number,description,amount,status,reminder_enabled,next_reminder_at,due_date) values($1,$2,$3,'SYNTHETIC','Fixture',120,'finalised',true,now()-interval '1 day',current_date-1)",[invoice,owner,client]);
 async function stamp(){return (await db.query<{s:string}>('select updated_at::text s from invoices where id=$1',[invoice])).rows[0].s}
 const initial=await stamp();await db.exec('set role service_role');
 async function draft(subject='Review £120'){return (await db.query<{id:string}>("select create_due_reminder($1,$2,$3,12000,'from@example.invalid','to@example.invalid',$4,'£120 (one hundred and twenty pounds)') id",[owner,invoice,initial,subject])).rows[0].id}
 await assert.rejects(draft(''),/subject_not_blank/);assert.equal((await db.query<{enabled:boolean}>('select reminder_enabled enabled from invoices where id=$1',[invoice])).rows[0].enabled,true);
 const reminder=await draft();await assert.rejects(draft(),/changed|review/);
 const reviewed=(await db.query<{s:string}>('select updated_at::text s from invoice_reminders where id=$1',[reminder])).rows[0].s;
 async function claim(who=owner,confirmed=true,review=reviewed){return(await db.query<{r:{claimed:boolean;attempt_id:string;payload:{text:string}}}>('select claim_reminder_send($1,$2,$3,$4) r',[who,reminder,review,confirmed])).rows[0].r}
 await assert.rejects(claim(other),/unavailable/);await assert.rejects(claim(owner,false),/confirmation/);await assert.rejects(claim(owner,true,initial),/fresh/);
 await db.exec('reset role');await db.query("update clients set email='changed@example.invalid' where id=$1",[client]);await db.exec('set role service_role');await assert.rejects(claim(),/Recipient changed/);
 await db.exec('reset role');await db.query("update clients set email='to@example.invalid' where id=$1",[client]);await db.exec('set role service_role');
 const claims=await Promise.all([claim(),claim()]);assert.equal(claims.filter(c=>c.claimed).length,1);const won=claims.find(c=>c.claimed)!;
 assert.equal(won.payload.text,'£120 (one hundred and twenty pounds)');assert.equal((await claim()).claimed,false);
 await assert.rejects(db.query('delete from reminder_send_attempts'),/permission denied/);
 await db.query("select record_reminder_outcome($1,$2,'unknown',null)",[owner,won.attempt_id]);await db.query("select record_reminder_outcome($1,$2,'unknown',null)",[owner,won.attempt_id]);
 await assert.rejects(db.query("select record_reminder_outcome($1,$2,'accepted','late-id')",[owner,won.attempt_id]),/already recorded/);assert.equal((await claim()).claimed,false);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from reminder_send_attempts')).rows.length,0);
 await assert.rejects(db.query('select claim_reminder_send($1,$2,$3,true)',[owner,reminder,reviewed]),/permission denied/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await db.query('select * from reminder_send_attempts')).rows.length,1);
 await assert.rejects(db.query("update invoice_reminders set status='pending' where id=$1",[reminder]),/permission denied/);await assert.rejects(db.query('select discard_reminder($1)',[reminder]),/unavailable/);
 // Exercise accepted outcomes, a stop during transport, stale balances and discard.
 for(const scenario of ['accepted','stopped','balance_changed','discarded']){
  await db.exec('reset role');const next=randomUUID();
  await db.query("insert into invoices(id,user_id,client_id,number,description,amount,status,reminder_enabled,next_reminder_at,due_date) values($1,$2,$3,$4,'Fixture',120,'finalised',true,now()-interval '1 day',current_date-1)",[next,owner,client,'SYNTHETIC-'+scenario]);
  const version=(await db.query<{s:string}>('select updated_at::text s from invoices where id=$1',[next])).rows[0].s;
  await db.exec('set role service_role');
  const draft=(await db.query<{id:string}>("select create_due_reminder($1,$2,$3,12000,'from@example.invalid','to@example.invalid','Review','£120') id",[owner,next,version])).rows[0].id;
  const review=(await db.query<{s:string}>('select updated_at::text s from invoice_reminders where id=$1',[draft])).rows[0].s;
  if(scenario==='discarded'){
   await db.exec('reset role;set role authenticated');await db.query('select discard_reminder($1)',[draft]);
   assert.equal((await db.query<{status:string}>('select status from invoice_reminders where id=$1',[draft])).rows[0].status,'skipped');continue;
  }
  if(scenario==='balance_changed'){
   await db.exec('reset role');await db.query("update invoices set reminder_enabled=false where id=$1",[next]);await db.exec('set role service_role');
   await assert.rejects(db.query('select claim_reminder_send($1,$2,$3,true)',[owner,draft,review]),/balance changed/);continue;
  }
  const a=(await db.query<{r:{attempt_id:string}}>('select claim_reminder_send($1,$2,$3,true) r',[owner,draft,review])).rows[0].r;
  if(scenario==='stopped') {await db.exec('reset role');await db.query('update invoices set reminder_enabled=false,next_reminder_at=null where id=$1',[next]);await db.exec('set role service_role');}
  await assert.rejects(db.query("select record_reminder_outcome($1,$2,'accepted',null)",[owner,a.attempt_id]),/check constraint/);
  await db.query("select record_reminder_outcome($1,$2,'accepted','provider-id')",[owner,a.attempt_id]);
  await db.query("select record_reminder_outcome($1,$2,'accepted','provider-id')",[owner,a.attempt_id]);
  assert.equal((await db.query<{status:string}>('select status from invoice_reminders where id=$1',[draft])).rows[0].status,'sent');
  assert.equal((await db.query<{enabled:boolean}>('select reminder_enabled enabled from invoices where id=$1',[next])).rows[0].enabled,scenario==='accepted');
 }

});
