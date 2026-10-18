import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { bankValuationReadback,parseBankValuationReview } from '../records/bank-valuation-review';
import { parseBankValuationRevision } from '../records/bank-valuation';
import { rateFromDecimal } from '../fx/currency';

test('owned bank valuation review preserves exact source, original checks, versioning and historical retries without postings',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
 const auth=async(owner=f.owner)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated')};
 const read=async()=>parseBankValuationReview(f.owner,(await db.query<{r:unknown}>('select read_bank_valuation_review($1) r',[f.transaction])).rows[0].r);
 const save=async(intent:unknown,hash:string)=>(await db.query<{r:unknown}>('select review_bank_valuation($1,$2) r',[JSON.stringify(intent),hash])).rows[0].r;
 await auth();let context=await read();assert.equal(context.head,null);assert.equal(context.source?.original_signed_minor,-10001);assert.equal(context.can_change,true);
 assert.doesNotMatch(JSON.stringify(context),/object_path|key_id|raw_encrypted|Synthetic foreign observation/);
 const proposed={schema_version:'bank-valuation-intent/1',ruleset_id:'vibecount-currencies/1',transaction_id:f.transaction,transaction_version:0,expected_ordinal:0,state:'reviewed',document_id:f.document,
  data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','2.5'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'},human_read_original:true,expected_stamp:context.stamp,rationale:'Checked synthetic documented rate',request_id:randomUUID()};
 const preview=bankValuationReadback(f.owner,proposed,context);assert.equal(preview.conversion.target_minor,-2500);
 assert.throws(()=>bankValuationReadback(f.other,proposed,context));
 assert.throws(()=>bankValuationReadback(f.owner,{...proposed,transaction_version:1},context));
 assert.throws(()=>bankValuationReadback(f.owner,proposed,{...context,can_change:false}));
 await assert.rejects(save(preview.intent,'0'.repeat(64)),/matching local original/);
 const saved=await save(preview.intent,f.documentHash),revision=parseBankValuationRevision(f.owner,saved);assert.equal(revision.signed_gbp_pence,-2500);
 context=await read();assert.equal(context.head?.ordinal,1);assert.equal(context.head_current,true);
 await assert.rejects(save({...proposed,request_id:randomUUID()},f.documentHash),/changed/);
 await assert.rejects(save({...proposed,rationale:'Changed completed request'},f.documentHash),/request changed/);
 const zero=bankValuationReadback(f.owner,{...proposed,expected_ordinal:1,expected_stamp:context.stamp,request_id:randomUUID(),data:{...proposed.data,rate:rateFromDecimal('KWD','GBP','0.00001')}},context);
 assert.equal(zero.conversion.target_minor,0);await save(zero.intent,f.documentHash);
 await db.exec('reset role');await db.query('delete from storage.objects where name=$1',[f.documentPath]);await auth();
 assert.deepEqual(await save(preview.intent,''),saved);context=await read();assert.equal(context.head_current,false);
 const withdrawal=bankValuationReadback(f.owner,{...proposed,state:'withdrawn',document_id:null,data:null,transaction_version:null,human_read_original:false,expected_ordinal:2,expected_stamp:context.stamp,request_id:randomUUID()},context);
 const withdrawn=parseBankValuationRevision(f.owner,await save(withdrawal.intent,''));assert.equal(withdrawn.state,'withdrawn');assert.equal(withdrawn.signed_gbp_pence,0);
 assert.equal((await db.query('select id from financial_records where user_id=$1',[f.owner])).rows.length,0);
 await auth(f.other);await assert.rejects(read(),/owned foreign observation/);await assert.rejects(save(proposed,f.documentHash),/matching local original/);
 for(const role of ['anon','service_role']){
  await db.exec('reset role;set role '+role);await assert.rejects(db.query('select read_bank_valuation_review($1)',[f.transaction]),/permission denied/);
  await assert.rejects(save(proposed,f.documentHash),/permission denied/);
 }
});
