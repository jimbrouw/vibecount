import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {deliverClaimedReminder,type ReminderClaim} from '../invoices/reminder-delivery';
test('independent reminder confirmations wait for the durable claim and invoke transport once',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-reminder-pg-'));
 const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string'){s.close();reject(new Error('No test port'));return}s.close(()=>resolve(a.port))})});
 const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:false,createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:()=>{}});
 let started=false;const clients:ReturnType<typeof cluster.getPgClient>[]=[];
 t.after(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)await cluster.stop();await rm(directory,{recursive:true,force:true})});
 await cluster.initialise();await cluster.start();started=true;
 const admin=cluster.getPgClient('postgres','127.0.0.1'),first=cluster.getPgClient('postgres','127.0.0.1'),second=cluster.getPgClient('postgres','127.0.0.1');clients.push(admin,first,second);await Promise.all(clients.map(c=>c.connect()));
 await admin.query(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await admin.query(await readFile(new URL(name,dir),'utf8'));

 const owner=randomUUID(),client=randomUUID(),invoice=randomUUID();await admin.query('insert into auth.users(id) values($1)',[owner]);await admin.query("insert into clients(id,user_id,name,email) values($1,$2,'Synthetic','to@example.invalid')",[client,owner]);
 await admin.query("insert into invoices(id,user_id,client_id,number,description,amount,status,reminder_enabled,next_reminder_at,due_date) values($1,$2,$3,'SYNTHETIC','Fixture',120,'finalised',true,now()-interval '1 day',current_date-1)",[invoice,owner,client]);
 const version=(await admin.query('select updated_at::text s from invoices where id=$1',[invoice])).rows[0].s;
 const reminder=(await admin.query("select create_due_reminder($1,$2,$3,12000,'from@example.invalid','to@example.invalid','Review','£120') id",[owner,invoice,version])).rows[0].id;
 const review=(await admin.query('select updated_at::text s from invoice_reminders where id=$1',[reminder])).rows[0].s;
 for(const c of [first,second])await c.query("set statement_timeout='8s';set role service_role");
 const pid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 await first.query('begin');
 const won=(await first.query('select claim_reminder_send($1,$2,$3,true) r',[owner,reminder,review])).rows[0].r as ReminderClaim;
 const pending=second.query('select claim_reminder_send($1,$2,$3,true) r',[owner,reminder,review]);
 let waiting=false;for(let n=0;n<500;n++) {const state=(await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];if(state?.wait_event_type==='Lock'){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,5))}
 assert.equal(waiting,true);await first.query('commit');const lost=(await pending).rows[0].r as ReminderClaim;
 assert.equal(won.claimed,true);assert.equal(lost.claimed,false);
 let sends=0;const io={send:async()=>{sends++;return {id:randomUUID()}},record:async(attempt:string,outcome:string,id:string|null)=>{await admin.query('select record_reminder_outcome($1,$2,$3,$4)',[owner,attempt,outcome,id])}};
 await Promise.all([deliverClaimedReminder(won,io),deliverClaimedReminder(lost,io)]);assert.equal(sends,1);
 assert.equal((await admin.query('select count(*)::int n from reminder_send_attempts')).rows[0].n,1);
});
