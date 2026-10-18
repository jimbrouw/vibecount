import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
type Review={inventory_sha256:string;review_sha256:string;confirmation_enabled:boolean;retained_material:string};
test('private deletion request freezes exact reviewed dependencies, targets copies and preserves financial history',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);t.after(()=>f.key.fill(0));
 const auth=async(owner=f.owner)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated')};
 const review=async()=>{await auth();return(await db.query<{r:Review}>("select review_evidence_deletion('source',$1) r",[f.imported])).rows[0].r};
 const request=randomUUID(),sql="select record_evidence_deletion_request('source',$1,$2,$3,'evidence-deletion/1','Synthetic explicit request',$4,$5) id";
 const args=(r:Review,id=request,confirmed=true)=>[f.imported,r.inventory_sha256,r.review_sha256,id,confirmed];
 await assert.rejects(db.query('update source_rows set raw_encrypted=null'),/immutable/);
 await assert.rejects(db.query('update document_batch_items set original_name_encrypted=null'),/immutable/);
 const initial=await review();assert.equal(initial.confirmation_enabled,false);assert.match(initial.retained_material,/saved snapshots/i);assert.doesNotMatch(JSON.stringify(initial),/"raw_encrypted"|"object_path"|PRIVATE|"key_id"/);
 // A different owner's settings must not change this owner's review fingerprint.
 await db.exec('reset role');await db.query("insert into user_settings(id,legal_name) values($1,'PRIVATE OTHER OWNER') on conflict(id) do update set legal_name=excluded.legal_name",[f.other]);assert.equal((await review()).review_sha256,initial.review_sha256);
 for(const role of ['authenticated','service_role','anon']){await db.exec('reset role;set role '+role);await assert.rejects(db.query(sql,args(initial)),/permission denied/)}
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
 await assert.rejects(db.query(sql,args(initial,request,false)),/Confirm the exact/);
 const record=(await db.query<{id:string}>("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'expense','2026-04-05','Synthetic retained record',1,'draft') returning id",[f.owner])).rows[0].id;
 const current=await review();assert.notEqual(current.review_sha256,initial.review_sha256);
 await db.exec('reset role');await assert.rejects(db.query(sql,args(initial)),/dependencies changed/);
 const rawBefore=(await db.query('select * from source_rows')).rows,recordsBefore=(await db.query('select * from financial_records')).rows;
 await db.query("update financial_records set amount=2 where id=$1",[record]);
 await assert.rejects(db.query(sql,args(current)),/dependencies changed/);
 await db.query("update financial_records set amount=1 where id=$1",[record]);
 const final=await review();await db.exec('reset role');const result=(await db.query<{id:string}>(sql,args(final))).rows[0].id;assert.equal(result,request);
 assert.equal((await db.query(sql,args(final))).rows.length,1);
 await assert.rejects(db.query(sql,args(final,randomUUID())),/dependencies changed|already belongs/);
 assert.equal((await db.query('select * from evidence_deletion_requests')).rows.length,1);
 assert.equal((await db.query('select * from evidence_deletion_targets')).rows.length,1);
 assert.equal((await db.query('select * from storage.objects')).rows.length,2);
 assert.deepEqual((await db.query('select * from source_rows')).rows,rawBefore);
 // Changes recorded before the request remain; request itself creates no posting.
 assert.equal((await db.query('select * from financial_records')).rows.length,recordsBefore.length);
 assert.equal((await db.query<{amount:string}>('select amount::text amount from financial_records where id=$1',[record])).rows[0].amount,'1.00');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await assert.rejects(db.query(sql,args(final)),/different review/);
 await assert.rejects(db.query('delete from evidence_deletion_requests'),/immutable|preserved|append.only/i);
 // Shared archive closure must be committed atomically, including duplicate copies.
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
 for(const hash of ['b'.repeat(64),'c'.repeat(64)]){
  const a=randomUUID(),objects=[hash,f.documentHash].map((h,i)=>({hash:h,path:`${f.owner}/${a}/${i}.enc`,size:100,media_type:i===0?'application/zip':'application/pdf',key_id:'synthetic',name_encrypted:'PRIVATE'}));
  await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[a,f.owner,hash,JSON.stringify(objects)]);
  for(const o of objects)await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[o.path]);
  await db.query("select register_document_intake($1,$2,2025,'other','opaque-evidence/1')",[f.owner,a]);
 }
 const attempt=(await db.query<{id:string}>('select id from document_upload_attempts where user_id=$1 and file_hash=$2',[f.owner,f.documentHash])).rows[0].id,operation=randomUUID();
 await db.query("select begin_evidence_upload($1,'document',$2,$3,$4)",[f.owner,attempt,f.documentPath,operation]);
 const docReview=async()=>(await db.query<{r:Review}>("select review_evidence_deletion('document',$1) r",[f.document])).rows[0].r;
 const docSql="select record_evidence_deletion_request('document',$1,$2,$3,'evidence-deletion/1','Synthetic shared archive review',$4,true)";
 const documentRequest=randomUUID(),docArgs=(r:Review)=>[f.document,r.inventory_sha256,r.review_sha256,documentRequest];
 await assert.rejects(db.query(docSql,docArgs(await docReview())),/upload outcome is unresolved/);
 await db.query('select completed_evidence_upload($1,$2)',[f.owner,operation]);
 const dr=await docReview(),documentRows=(await db.query('select * from document_batch_items order by id')).rows;
 await db.exec("create function public.reject_request_target_fixture() returns trigger language plpgsql as $$begin raise exception 'Synthetic target failure';end$$;create trigger reject_request_target_fixture after insert on evidence_deletion_targets for each row execute function public.reject_request_target_fixture()");
 await assert.rejects(db.query(docSql,docArgs(dr)),/Synthetic target failure/);
 assert.equal((await db.query('select * from evidence_deletion_requests')).rows.length,1);
 assert.equal((await db.query('select * from evidence_deletion_targets')).rows.length,1);
 await db.exec('drop trigger reject_request_target_fixture on evidence_deletion_targets;drop function public.reject_request_target_fixture()');
 await db.query(docSql,docArgs(dr));
 assert.equal((await db.query("select * from evidence_deletion_targets where request_id=$1",[documentRequest])).rows.length,5);
 assert.deepEqual((await db.query('select * from document_batch_items order by id')).rows,documentRows);

 // Explicit private scrubbing clears only ciphertext in the confirmed scope.
 const untouched=await bankValuationFixture(db,'KWD','-20.002',f.other);t.after(()=>untouched.key.fill(0));
 const rowsBeforeScrub=(await db.query<Record<string,unknown>>('select * from source_rows order by id')).rows;
 const namesBeforeScrub=(await db.query<Record<string,unknown>>('select * from document_batch_items order by id')).rows;
 const plansBeforeScrub=(await db.query<{id:string;planned_objects:Record<string,unknown>[]}>('select id,planned_objects from document_upload_attempts order by id')).rows;
 const financialBeforeScrub=(await db.query('select * from financial_records order by id')).rows;
 const scrub=(id:string,owner=f.owner)=>db.query<{r:{raw_rows:number;batch_names:number;planned_names:number}}>('select scrub_evidence_deletion_request($1,$2) r',[owner,id]);
 await assert.rejects(scrub(request,f.other),/Owned confirmed deletion/);
 await db.exec("create function public.reject_scrub_fixture() returns trigger language plpgsql as $$begin raise exception 'Synthetic scrub audit failure';end$$;create trigger reject_scrub_fixture before insert on evidence_deletion_scrubs for each row execute function public.reject_scrub_fixture()");
 await assert.rejects(scrub(request),/Synthetic scrub audit failure/);
 assert.deepEqual((await db.query('select * from source_rows order by id')).rows,rowsBeforeScrub);
 await db.exec('drop trigger reject_scrub_fixture on evidence_deletion_scrubs;drop function public.reject_scrub_fixture()');
 const scrubbed=(await scrub(request)).rows[0].r;assert.equal(Number(scrubbed.raw_rows),1);assert.deepEqual((await scrub(request)).rows[0].r,scrubbed);
 const rowsAfter=(await db.query('select * from source_rows order by id')).rows;
 assert.deepEqual(rowsAfter,rowsBeforeScrub.map(r=>r.user_id===f.owner?{...r,raw_encrypted:null}:r));
 const cleared=(await scrub(documentRequest)).rows[0].r;assert.equal(Number(cleared.batch_names),5);assert.equal(Number(cleared.planned_names),5);
 const namesAfter=(await db.query('select * from document_batch_items order by id')).rows;
 assert.deepEqual(namesAfter,namesBeforeScrub.map(r=>r.user_id===f.owner?{...r,original_name_encrypted:null}:r));
 const plansAfter=(await db.query<{id:string;planned_objects:Record<string,unknown>[]} >('select id,planned_objects from document_upload_attempts order by id')).rows;
 const untouchedAttempt=(await db.query<{id:string}>('select id from document_upload_attempts where user_id=$1',[f.other])).rows[0].id;
 assert.deepEqual(plansAfter,plansBeforeScrub.map(r=>r.id===untouchedAttempt?r:{...r,planned_objects:(r.planned_objects as Record<string,unknown>[]).map(v=>({...v,name_encrypted:null}))}));
 assert.deepEqual((await db.query('select * from financial_records order by id')).rows,financialBeforeScrub);
 await assert.rejects(db.query("update source_rows set raw_encrypted='restored' where id=$1",[f.row]),/immutable/);
 await assert.rejects(db.query("update source_rows set row_number=999 where id=$1",[f.row]),/immutable/);
 await assert.rejects(db.query("update document_batch_items set original_name_encrypted='restored' where user_id=$1",[f.owner]),/immutable/);
 await assert.rejects(db.query("update document_upload_attempts set planned_objects=jsonb_set(planned_objects,'{0,name_encrypted}','\"restored\"') where id=$1",[attempt]),/immutable/);
 await auth();const remaining=(await db.query<{r:{counts:Record<string,number>}}>("select preview_evidence_deletion('document',$1) r",[f.document])).rows[0].r;
 assert.equal(remaining.counts.document_name_copies,0);
 assert.equal((await db.query<{r:{counts:Record<string,number>}}>("select preview_evidence_deletion('source',$1) r",[f.imported])).rows[0].r.counts.raw_source_rows,0);
 for(const role of ['authenticated','anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(scrub(request),/permission denied/)}
 await db.exec('reset role;set role service_role');
 await assert.rejects(db.query("insert into source_rows(user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,999,$3,'new ciphertext')",[f.owner,f.imported,'d'.repeat(64)]),/marked for deletion/);
 await assert.rejects(db.query("insert into source_rows(user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,999,$3,null)",[untouched.owner,untouched.imported,'d'.repeat(64)]),/requires preserved ciphertext/);
 await db.exec('reset role');
 // Removal outcomes require a scrubbed owned target and independent absence.
 const removal=randomUUID();
 const begin=(id=removal,owner=f.owner)=>db.query('select begin_evidence_removal($1,$2,$3,$4,$5)',[owner,request,'source-evidence',f.path,id]);
 const outcome=(value:string,absent:boolean,id=removal,owner=f.owner)=>db.query('select record_evidence_removal_outcome($1,$2,$3,$4)',[owner,id,value,absent]);
 await assert.rejects(begin(removal,f.other),/Owned scrubbed/);
 await begin();
 await assert.rejects(begin(),/pending/);
 await assert.rejects(begin(randomUUID()),/pending/);
 await assert.rejects(outcome('absent',false),/Exact provider/);
 await assert.rejects(outcome('absent',true),/metadata still/);
 await assert.rejects(outcome('unknown',false,removal,f.other),/Owned removal/);
 await outcome('unknown',false);await outcome('unknown',false);
 await assert.rejects(outcome('failed',false),/immutable/);
 const retry=randomUUID();await begin(retry);
 // Simulate provider deletion only inside this disposable database.
 await db.query('delete from storage.objects where bucket_id=$1 and name=$2',['source-evidence',f.path]);
 await outcome('absent',true,retry);await outcome('absent',true,retry);
 await assert.rejects(begin(randomUUID()),/verified absent/);
 assert.deepEqual((await db.query('select * from financial_records order by id')).rows,financialBeforeScrub);
 for(const role of ['authenticated','anon','service_role']){
  await db.exec('reset role;set role '+role);
  await assert.rejects(begin(randomUUID()),/permission denied/);
  await assert.rejects(outcome('absent',true,retry),/permission denied/);
 }

});
