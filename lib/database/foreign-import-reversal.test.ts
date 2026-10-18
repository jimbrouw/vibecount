import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { foreignImportReversalReview } from '../records/foreign-import-reversal';
import { type CurrencyCode } from '../fx/currency';
test('foreign import reversal excludes exact GBP effects, retains originals/ancestry and recovers exact retries',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 await openSyntheticForeignAdmission(db);
 for(const [currency,amount] of [['KWD','-10.001'],['USD','1.25'],['EUR','-2.00'],['JPY','1']] as [CurrencyCode,string][]){
  await db.exec('reset role');const f=await bankValuationFixture(db,currency,amount),v=await f.record(await f.intent()) as {id:string};
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role authenticated');
  const context=(await db.query<{r:{stamp:string;categories:{id:string;record_type:string}[]}}>('select read_foreign_classification_review($1) r',[f.transaction])).rows[0].r;
  const intent={schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:0,valuation_revision_id:v.id,classification:'Business',category_id:context.categories.find(c=>c.record_type===(amount.startsWith('-')?'expense':'income'))!.id,business_use_bps:10000,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:true,expected_stamp:context.stamp,rationale:'Synthetic reviewed classification',request_id:randomUUID(),human_confirmed:true};
  const posted=(await db.query<{r:{record_id:string|null;recognized_pence:number}}>('select confirm_foreign_classification($1) r',[JSON.stringify(intent)])).rows[0].r;
  const read=async()=>foreignImportReversalReview(f.owner,(await db.query<{r:unknown}>('select read_foreign_import_reversal($1) r',[f.imported])).rows[0].r);
  // A genuine repeated observation in the same file has its own source row and decision.
  await db.exec('reset role');const extraRow=randomUUID(),extraTx=randomUUID();
  await db.query('insert into source_rows(id,user_id,import_id,row_number,row_hash,raw_encrypted) select $1,user_id,import_id,3,row_hash,raw_encrypted from source_rows where id=$2',[extraRow,f.row]);
  await db.query("insert into bank_transactions(id,user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,fingerprint,original_signed_minor,source_units_ruleset) select $1,user_id,account_id,import_id,$2,transaction_date,null,currency,description,$3,original_signed_minor,source_units_ruleset from bank_transactions where id=$4",[extraTx,extraRow,'f'.repeat(64),f.transaction]);
  await db.exec('set role authenticated');
  let review=await read();assert.equal(review.sources[0].original_signed_minor,f.parsed.signedOriginalMinor);assert.equal(review.sources.find(s=>s.id===f.transaction)!.approved_pence,posted.recognized_pence);
  assert.doesNotMatch(JSON.stringify(review),/object_path|raw_encrypted|key_id/);
  const request=randomUUID(),reverse=async(stamp=review.stamp,reason='Reviewed all original and GBP effects')=>(await db.query<{r:Record<string,unknown>}>('select reverse_foreign_import_reviewed($1,$2,$3,$4) r',[f.imported,stamp,reason,request])).rows[0].r;
  // Model a retained relationship from a future foreign identity workflow, only in this disposable DB.
  // The actual dependency row must block reversal even without a transaction marker.
  await db.exec('reset role;begin;alter table duplicate_decisions disable trigger native_bank_event');
  const duplicateRequest=randomUUID();await db.query("insert into duplicate_requests(user_id,request_id,payload_hash,result) values($1,$2,'synthetic','{}')",[f.owner,duplicateRequest]);
  await db.query("insert into duplicate_decisions(user_id,transaction_id,retained_transaction_id,verdict,rationale,subject_snapshot,retained_snapshot,cohort_snapshot,reviewed_stamp,author,request_id) values($1,$2,$3,'duplicate','Synthetic dependency','{}','{}','[]','synthetic',$1,$4)",[f.owner,extraTx,f.transaction,duplicateRequest]);
  await db.exec('set role authenticated');assert.equal((await read()).blocked,true);await assert.rejects(reverse(),/dependent relationships/);await db.exec('rollback;set role authenticated');
  assert.equal((await read()).stamp,review.stamp);
  await db.exec('reset role');await db.query('delete from storage.objects where name=$1',[f.documentPath]);await db.exec('set role authenticated');
  await assert.rejects(reverse(),/review changed/);review=await read();
  // Fail the second child after the first update; the whole transaction must roll back.
  await db.exec('reset role');await db.exec(`create function public.synthetic_reversal_failure() returns trigger language plpgsql as $$begin if new.transaction_id='${review.sources[1].id}'::uuid and new.classification='Unknown' then raise exception 'Synthetic second-child failure';end if;return new;end;$$;create trigger synthetic_reversal_failure before insert on classification_decisions for each row execute function synthetic_reversal_failure();`);await db.exec('set role authenticated');
  await assert.rejects(reverse(),/Synthetic second-child failure/);
  assert.equal((await read()).stamp,review.stamp);
  await db.exec('reset role;drop trigger synthetic_reversal_failure on classification_decisions;drop function synthetic_reversal_failure();set role authenticated');
  const result=await reverse();assert.equal((result.children as unknown[]).length,2);assert.equal(result[amount.startsWith('-')?'expense_delta_pence':'income_delta_pence'],-posted.recognized_pence||0);
  assert.deepEqual(await reverse(),result);assert.equal((await db.query<{n:number}>("select count(*)::int n from source_import_events where import_id=$1 and event='reversed'",[f.imported])).rows[0].n,1);await assert.rejects(reverse(review.stamp,'Changed retry'),/request changed/);
  const tx=(await db.query<{recognized_record_id:string|null;classification:string;decision_version:number}>('select recognized_record_id,classification,decision_version from bank_transactions where id=$1',[f.transaction])).rows[0];
  assert.equal(tx.recognized_record_id,posted.record_id);assert.equal(tx.classification,'Unknown');assert.equal(tx.decision_version,2);assert.equal((await read()).blocked,true);
  assert.equal((await db.query('select id from financial_records where bank_transaction_id=$1 and status=\'approved\'',[f.transaction])).rows.length,0);
  assert.equal((await db.query('select id from bank_valuation_revisions where user_id=$1',[f.owner])).rows.length,1);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await db.exec('set role authenticated');await assert.rejects(read(),/Owned preserved/);await assert.rejects(reverse());
  for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(read(),/permission denied/);await assert.rejects(reverse(),/permission denied/);}
 }
});
