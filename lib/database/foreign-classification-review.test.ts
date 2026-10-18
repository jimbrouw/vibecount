import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { foreignClassificationReadback,parseForeignClassificationReview,foreignClassificationResult } from '../records/foreign-classification-review';
import { rateFromDecimal } from '../fx/currency';

test('authenticated foreign classification review binds category freshness, exact effects, corrections, zero and historical replay',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);await f.record(await f.intent());
 const auth=async(owner=f.owner)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated')};
 const read=async()=>parseForeignClassificationReview(f.owner,(await db.query<{r:unknown}>('select read_foreign_classification_review($1) r',[f.transaction])).rows[0].r);
 const save=async(intent:ReturnType<typeof foreignClassificationReadback>['intent'])=>foreignClassificationResult((await db.query<{r:unknown}>('select confirm_foreign_classification($1) r',[JSON.stringify(intent)])).rows[0].r,intent);
 await auth();let context=await read();
 const proposal=(classification='Business',bps=10000)=>({schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:context.valuation.transaction.decision_version,
  valuation_revision_id:bps?context.valuation.head!.id:null,classification,category_id:bps?context.categories.find(c=>c.record_type==='expense')!.id:null,
  business_use_bps:bps,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:!!bps,expected_stamp:context.stamp,rationale:'Reviewed synthetic original and treatment',request_id:randomUUID(),human_confirmed:true});
 assert.equal(context.current.recognized_pence,0);assert.equal(context.can_classify,true);
 assert.doesNotMatch(JSON.stringify(context),/object_path|key_id|raw_encrypted|Synthetic foreign observation/);
 assert.equal((await db.query('select id from financial_records where user_id=$1',[f.owner])).rows.length,0);
 assert.throws(()=>parseForeignClassificationReview(f.owner,{...context,categories:[{...context.categories[0],record_type:['expense']}]}));
 assert.throws(()=>foreignClassificationReadback(f.owner,proposal(),{...context,can_classify:false}));
 const stale=foreignClassificationReadback(f.owner,proposal(),context).intent;
 await db.exec('reset role');await db.query("update record_categories set name=name||' reviewed' where id=$1",[stale.category_id]);await auth();
 await assert.rejects(save(stale),/review changed/);context=await read();
 const preview=foreignClassificationReadback(f.owner,proposal(),context);assert.equal(preview.recognized_pence,2500);assert.equal(preview.change_pence,2500);
 const first=await save(preview.intent);assert.equal(first.recognized_pence,2500);
 assert.throws(()=>foreignClassificationResult({...first,record_type:['expense']},preview.intent));
 context=await read();assert.equal(context.current.recognized_pence,2500);
 const mixed=foreignClassificationReadback(f.owner,proposal('Mixed',3000),context);assert.equal(mixed.recognized_pence,750);assert.equal(mixed.change_pence,-1750);await save(mixed.intent);
 context=await read();const unknown=foreignClassificationReadback(f.owner,proposal('Unknown',0),context);assert.equal(unknown.change_pence,-750);await save(unknown.intent);
 await db.exec('reset role');await f.record(await f.intent({transaction_version:3,expected_ordinal:1,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}));await auth();
 context=await read();const zero=foreignClassificationReadback(f.owner,proposal(),context);assert.equal(zero.recognized_pence,0);await save(zero.intent);
 await db.exec('reset role');await db.query('delete from storage.objects where name=$1',[f.documentPath]);await auth();
 assert.deepEqual(await save(preview.intent),first);context=await read();assert.equal(context.valuation.head_current,false);
 assert.throws(()=>foreignClassificationReadback(f.owner,proposal(),context),/current exact GBP valuation/);
 await save(foreignClassificationReadback(f.owner,proposal('Personal',0),context).intent);
 assert.equal((await db.query('select id from financial_records where user_id=$1',[f.owner])).rows.length,1);
 assert.equal((await db.query("select id from financial_records where user_id=$1 and status='approved'",[f.owner])).rows.length,0);
 await auth(f.other);await assert.rejects(read(),/owned foreign observation/);await assert.rejects(save(preview.intent));
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(read(),/permission denied/);await assert.rejects(save(preview.intent),/permission denied/);}
});
