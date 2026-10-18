import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';

test('hosted receipt refunds and original corrections serialize across PostgreSQL connections',{timeout:45000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-receipt-race-'));
 const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string'){s.close();reject(new Error('No test port'));return}s.close(()=>resolve(a.port))})});
 const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:false,createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:()=>{}});
 let started=false;const clients:ReturnType<typeof cluster.getPgClient>[]=[];
 t.after(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)await cluster.stop();await rm(directory,{recursive:true,force:true})});
 await cluster.initialise();await cluster.start();started=true;
 const admin=cluster.getPgClient('postgres','127.0.0.1'),first=cluster.getPgClient('postgres','127.0.0.1'),second=cluster.getPgClient('postgres','127.0.0.1');clients.push(admin,first,second);await Promise.all(clients.map(c=>c.connect()));
 await admin.query(TEST_SCHEMA_BOOTSTRAP);
 const local=new URL('../../supabase/migrations/',import.meta.url),hosted=new URL('../../fixtures/hosted-baseline/',import.meta.url);
 const names=(await readdir(local)).filter(n=>n.endsWith('.sql')).sort();
 for(const [dir,files] of [[local,names.filter(n=>n<'202607')],[hosted,(await readdir(hosted)).filter(n=>n.endsWith('.sql')).sort()],[local,names.filter(n=>n>='202607')]] as const)for(const file of files)await admin.query(await readFile(new URL(file,dir),'utf8'));
 const owner=randomUUID();await admin.query('insert into auth.users(id) values($1)',[owner]);
 const category=(await admin.query("select id from record_categories where record_type='expense' and is_default order by id limit 1")).rows[0].id;
 for(const c of [first,second]){await c.query("set statement_timeout='8s'");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await c.query('set role authenticated')}
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 const waitForLock=async()=>{for(let n=0;n<500;n++){if((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[secondPid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('Expected second independent connection to block on original expense')};
 const attachment=async()=>{const id=randomUUID();await admin.query("insert into record_attachments(id,user_id,object_path,original_filename,content_type,size_bytes,receipt_state) values($1,$2,$3,'synthetic.pdf','application/pdf',100,'review')",[id,owner,owner+'/'+id]);return id};
 const details={amountConfirmed:true,currency:'GBP',grossPence:10000,vatPence:null,businessUsePercent:100,categoryId:category,matchRecordId:null,refundOf:null,paymentStatus:'paid',kind:'expense',merchant:'Synthetic race',documentDate:'2025-08-01',paymentDate:'2025-08-01'};
 const confirm=async(c:typeof first,id:string,changes:object={})=>(await c.query('select confirm_receipt_document($1,$2::jsonb) id',[id,JSON.stringify({...details,...changes})])).rows[0].id as string;
 const makeOriginal=async()=>{const attachmentId=await attachment();return {attachmentId,id:await confirm(first,attachmentId)}};
 const refund=async(c:typeof first,id:string,original:string)=>confirm(c,id,{kind:'refund',refundOf:original,grossPence:6000});
 // Both refunds fit alone; their combined amount must never be approved.
 const original=await makeOriginal(),a=await attachment(),b=await attachment();
 await first.query('begin');await refund(first,a,original.id);
 const competing=refund(second,b,original.id).then(()=>null,error=>error);
 await waitForLock();await first.query('commit');assert.match(String(await competing),/Refunds exceed/);
 assert.equal(Number((await admin.query('select sum(amount) amount from financial_records where refund_of=$1',[original.id])).rows[0].amount),60);
 // Exercise both lock orders for shrinking and marking the original unpaid.
 for(const correction of [{grossPence:5000},{paymentStatus:'unpaid',paymentDate:null}]){
  const before=await makeOriginal(),r=await attachment();
  await first.query('begin');await confirm(first,before.attachmentId,correction);
  const waitingRefund=refund(second,r,before.id).then(()=>null,error=>error);
  await waitForLock();await first.query('commit');assert.match(String(await waitingRefund),/Refunds exceed|original approved expense|original approved paid/);
  assert.equal((await admin.query('select count(*)::int n from financial_records where refund_of=$1',[before.id])).rows[0].n,0);
  const after=await makeOriginal(),s=await attachment();
  await first.query('begin');await refund(first,s,after.id);
  const waitingCorrection=confirm(second,after.attachmentId,correction).then(()=>null,error=>error);
  await waitForLock();await first.query('commit');assert.match(String(await waitingCorrection),/linked refunds/);
  const row=(await admin.query('select amount,payment_status from financial_records where id=$1',[after.id])).rows[0];assert.equal(Number(row.amount),100);assert.equal(row.payment_status,'paid');
 }
});
