import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID,randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { persistDimensionedSourceCsv,verifyDimensionedSourceRecovery,type DimensionedSourceAttempt,type PreparedDimensionedSourceRow } from '../records/source-persistence-v2';
import { recoveryReview, type RecoveryChoice } from '../records/recovery-review';
import { readSourceCsv,suggestMapping } from '../records/source-csv';

test('V2 registration preserves native identity, exact foreign observations, dedupe, recovery and zero postings',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019170000_dimensioned_source_registration.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const identity=async()=>(await db.query("select oid::text,proacl::text from pg_proc where oid='public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure")).rows;
 const base=async()=>(await db.query("select pg_get_functiondef('public.ingest_source_csv_v20_base(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure) body")).rows;
 const before=await identity(),native=await base();await db.exec(await readFile(new URL(target,dir),'utf8'));
 assert.deepEqual(await identity(),before);assert.deepEqual(await base(),native);
 await db.exec(await readFile(new URL('20261019180000_foreign_source_closure.sql',dir),'utf8'));
 const grants=(await db.query<{direct:boolean;wrapper:boolean}>("select has_function_privilege('service_role','public.ingest_dimensioned_source_csv(uuid,uuid,jsonb)','execute') direct,has_function_privilege('service_role','public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb)','execute') wrapper")).rows[0];assert.equal(grants.direct,false);assert.equal(grants.wrapper,true);
 assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);
 await openSyntheticForeignAdmission(db);
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),key=randomBytes(32);await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,currency,masked_identifier) values($1,$2,'Synthetic','generic','bank','KWD','1234')",[account,owner]);
 const objects=new Map<string,Buffer>();let latest:DimensionedSourceAttempt;let latestRows:PreparedDimensionedSourceRow[]=[];
 const register=async(a:DimensionedSourceAttempt,rows:PreparedDimensionedSourceRow[])=>{
  await db.exec('set role service_role');try{return(await db.query<{r:{import_id:string;created:boolean;transactions:number}}>('select ingest_source_csv($1,$2,$3,$4,$5,$6) r',[a.user_id,a.id,a.recovery_plan.filename,a.recovery_plan.parser,JSON.stringify(a.recovery_plan.mapping),JSON.stringify(rows)])).rows[0].r}finally{await db.exec('reset role')}
 };
 const ingest=async(text:string,fail=false)=>{const bytes=Buffer.from(text),mapping=suggestMapping(readSourceCsv(text)[0],'generic');return persistDimensionedSourceCsv({owner,account,accountCurrency:'KWD',bytes,filename:'synthetic.csv',mapping},key,'retained',{
  async createAttempt(a){latest=a;await db.query('insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,recovery_plan) values($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.user_id,a.account_id,a.file_hash,a.object_path,a.key_id,a.size_bytes,JSON.stringify(a.recovery_plan)])},
  async upload(path,cipher){objects.set(path,cipher);await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path])},
  async transition(id,_owner,from,to){await db.query('update source_upload_attempts set state=$1 where id=$2 and state=any($3::text[])',[to,id,from])},
  async register(a,rows){latestRows=rows;if(fail)throw Error('Synthetic interrupted registration');return register(a,rows)},
 })};
 const csv='Date,Description,Amount,Currency\n05/04/2026,Repeated purchase,-10.001,KWD\n05/04/2026,Repeated purchase,-10.001,KWD\n06/04/2026,Income,12.500,KWD';
 const first=await ingest(csv);assert.equal(first.transactions,3);
 const rows=(await db.query<{original:string;signed_amount_pence:null;classification:string;dedupe_status:string}>('select original_signed_minor::text original,signed_amount_pence,classification,dedupe_status from bank_transactions order by transaction_date,original_signed_minor')).rows;
 assert.deepEqual(rows.map(r=>r.original),['-10001','-10001','12500']);assert.ok(rows.every(r=>r.signed_amount_pence===null&&r.classification==='Unknown'&&r.dedupe_status==='clear'));
 assert.deepEqual(await ingest(csv),{import_id:first.import_id,created:false,transactions:0});
 const completed=latest!;await db.query('delete from storage.objects where name=$1',[completed.object_path]);assert.equal((await register(completed,[])).import_id,first.import_id);
 const overlapping=await ingest(csv+'\n07/04/2026,Another purchase,-1.001,KWD');assert.equal(overlapping.transactions,4);
 assert.equal((await db.query<{n:number}>("select count(*)::int n from bank_transactions where import_id=$1 and dedupe_status='needs_review'",[overlapping.import_id])).rows[0].n,3);
 await assert.rejects(ingest(csv+'\n08/04/2026,Recovery receipt,2.001,KWD',true));
 const failed=latest!,prepared=latestRows,verified=await verifyDimensionedSourceRecovery(failed,owner,{activeId:'retained',ids:['retained'],key:()=>key},{async read(_bucket,path){return objects.get(path)??null},async upload(){throw Error('No replace')}});
 const safe=(await db.query<RecoveryChoice>('select * from evidence_recovery_attempts where id=$1',[failed.id])).rows[0];
 assert.deepEqual(recoveryReview(safe),{count:4,incoming:14501,outgoing:20002,currency:'KWD'});
 assert.doesNotMatch(JSON.stringify(safe),/object_path|key_id|raw_encrypted/);
 const countBefore=(await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n;
 await db.query("update source_upload_attempts set state='uploaded' where id=$1",[failed.id]);
 for(const patch of [{signed_pence:100},{original_signed_minor:0},{currency:'USD'},{currency_exponent:2},{source_units_ruleset:'unknown'},{row_hash:'bad'},{raw_encrypted:'bad'},{row_number:1},{private_extra:'no'}]){
  const broken=structuredClone(verified.rows);Object.assign(broken[0],patch);await assert.rejects(register(failed,broken));
  assert.equal((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n,countBefore);
 }
 for(const patch of [{dateFormat:null},{amountMode:null},{date:-1},{amount:-1},{description:failed.recovery_plan.mapping.date},{currency:failed.recovery_plan.mapping.amount}]){
  const plan={...failed.recovery_plan,mapping:{...failed.recovery_plan.mapping,...patch}};
  const id=randomUUID(),invalid={...failed,id,object_path:`${owner}/${account}/${id}.enc`,recovery_plan:plan} as DimensionedSourceAttempt;
  await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,recovery_plan,state) values($1,$2,$3,$4,$5,$6,$7,$8,'uploaded')",[id,owner,account,failed.file_hash,invalid.object_path,failed.key_id,failed.size_bytes,JSON.stringify(plan)]);
  await assert.rejects(register(invalid,verified.rows),/mapping|selected source columns/);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n,countBefore);
 }
 await db.query("update source_upload_attempts set state='failed' where id=$1",[failed.id]);
 assert.equal(verified.rows.length,4);assert.deepEqual(verified.rows.map(r=>r.fingerprint),prepared.map(r=>r.fingerprint));
 const stamp=(await db.query<{stamp:string}>('select stamp from evidence_recovery_attempts where id=$1',[failed.id])).rows[0].stamp,request=randomUUID();
 const recover=async()=> (await db.query<{r:{import_id:string;transactions:number}}>('select complete_evidence_recovery($1,$2,$3,$4,$5,$6,$7,$8) r',[owner,'source',failed.id,stamp,verified.manifest,JSON.stringify(verified.rows),'Synthetic recovery',request])).rows[0].r;
 const recovered=await recover();assert.equal(recovered.transactions,4);await db.query('delete from storage.objects where name=$1',[failed.object_path]);assert.deepEqual(await recover(),recovered);
 await assert.rejects(register({...failed,user_id:other},verified.rows),/not found/);
 // A privileged insert must not attach another import's row or currency to this observation.
 const source=(await db.query<{id:string;source_row_id:string}>('select id,source_row_id from bank_transactions where import_id=$1 limit 1',[first.import_id])).rows[0];
 const newRow=randomUUID();await db.query("insert into source_rows(id,user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,$3,100,$4,'synthetic')",[newRow,owner,first.import_id,'a'.repeat(64)]);
 const insert=async(importId:string,currency:string,signed:number|null)=>db.query(`insert into bank_transactions(user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,fingerprint,original_signed_minor,source_units_ruleset)
 select user_id,account_id,$2,$3,transaction_date,$5,$4,description,fingerprint,case when $4='GBP' then null else original_signed_minor end,case when $4='GBP' then null else source_units_ruleset end from bank_transactions where id=$1`,[source.id,importId,newRow,currency,signed]);
 await assert.rejects(insert(overlapping.import_id,'KWD',null),/matching owner/);
 await assert.rejects(insert(first.import_id,'USD',null),/matching owner/);
 await assert.rejects(insert(first.import_id,'GBP',100),/matching owner/);
 await insert(first.import_id,'KWD',null);
 assert.equal((await db.query('select id from financial_records')).rows.length,0);
});
