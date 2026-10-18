import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { foreignClassificationIntent,foreignClassificationAmount,FOREIGN_SHARE_POLICY } from '../records/foreign-classification';
import { rateFromDecimal } from '../fx/currency';

test('private foreign classifications retain exact valuation ancestry, one canonical effect, corrections and zero outcomes',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
 const category=(await db.query<{id:string}>("select id from record_categories where record_type='expense' and is_default limit 1")).rows[0].id;
 const v=await f.record(await f.intent()) as {id:string};
 const intent=async(classification='Business',bps=10000,valuation:string|null=v.id)=>foreignClassificationIntent({schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,
  transaction_version:(await db.query<{v:number}>('select decision_version v from bank_transactions where id=$1',[f.transaction])).rows[0].v,
  valuation_revision_id:valuation,classification,category_id:valuation?category:null,business_use_bps:bps,rounding_policy:FOREIGN_SHARE_POLICY,treatment_reviewed:!!valuation,
  expected_stamp:await stamp(),rationale:'Synthetic separate classification review',request_id:randomUUID(),human_confirmed:true});
 const stamp=async()=>(await db.query<{s:string}>('select foreign_classification_review_stamp($1) s',[f.owner])).rows[0].s;
 const save=async(i:unknown)=>(await db.query<{r:{version:number;recognized_pence:number;record_id:string|null}}>('select review_foreign_classification($1) r',[JSON.stringify(i)])).rows[0].r;
 const firstIntent=await intent(),first=await save(firstIntent);assert.equal(first.recognized_pence,2500);
 assert.deepEqual(foreignClassificationAmount(-10001,firstIntent,-2500),{record_type:'expense',recognized_pence:2500,rounding_policy:FOREIGN_SHARE_POLICY});
 assert.deepEqual(await save(firstIntent),first);
 await assert.rejects(save({...firstIntent,rationale:'Changed replay'}),/request changed/);
 await assert.rejects(save({...firstIntent,request_id:randomUUID()}),/review changed/);
 for(const sql of ["update financial_records set bank_transaction_id=null where id=$1","update financial_records set amount=999 where id=$1","delete from financial_records where id=$1"])
  await assert.rejects(db.query(sql,[first.record_id]),/foreign|Foreign/);
 await assert.rejects(db.query('update bank_transactions set decision_version=10 where id=$1',[f.transaction]),/Foreign decision/);
 await assert.rejects(f.record(await f.intent({transaction_version:1,expected_ordinal:1})),/dependent financial effects/);
 const mixedIntent=await intent('Mixed',3000),mixed=await save(mixedIntent);assert.equal(mixed.recognized_pence,750);assert.equal(mixed.record_id,first.record_id);
 const zero=await save(await intent('Unknown',0,null));assert.equal(zero.recognized_pence,0);
 assert.equal((await db.query<{status:string}>('select status from financial_records where id=$1',[first.record_id])).rows[0].status,'excluded');
 const zeroVal=await f.record(await f.intent({transaction_version:3,expected_ordinal:1,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}})) as {id:string};
 const zeroBusiness=await save(await intent('Business',10000,zeroVal.id));assert.equal(zeroBusiness.recognized_pence,0);assert.equal(zeroBusiness.record_id,first.record_id);
 await save(await intent('Personal',0,null));
 assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_records where bank_transaction_id=$1',[f.transaction])).rows[0].n,1);
 const decisions=(await db.query<{bank_valuation_revision_id:string|null;foreign_request_id:string}>('select bank_valuation_revision_id,foreign_request_id from classification_decisions where transaction_id=$1 order by version',[f.transaction])).rows;
 assert.deepEqual(decisions.map(d=>d.bank_valuation_revision_id),[v.id,v.id,null,zeroVal.id,null]);assert.ok(decisions.every(d=>d.foreign_request_id));
 const income=await bankValuationFixture(db,'USD','1.25',f.owner),incomeVal=await income.record(await income.intent()) as {id:string};
 const incomeCategory=(await db.query<{id:string}>("select id from record_categories where record_type='income' and is_default limit 1")).rows[0].id;
 const incoming=foreignClassificationIntent({...await intent(),transaction_id:income.transaction,transaction_version:0,valuation_revision_id:incomeVal.id,category_id:incomeCategory,expected_stamp:await stamp()});
 assert.equal((await save(incoming)).recognized_pence,313);
 await assert.rejects(db.query('update financial_records set bank_transaction_id=$1 where id=$2',[income.transaction,first.record_id]),/linkage/);
 const tiny=await bankValuationFixture(db,'KWD','0.001',f.owner),tinyVal=await tiny.record(await tiny.intent({data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}})) as {id:string};
 const tinyIntent=foreignClassificationIntent({...await intent(),transaction_id:tiny.transaction,transaction_version:0,valuation_revision_id:tinyVal.id,category_id:incomeCategory,expected_stamp:await stamp()});
 const tinyResult=await save(tinyIntent);assert.equal(tinyResult.recognized_pence,0);assert.equal(tinyResult.record_id,null);
 assert.equal((await db.query('select id from financial_records where bank_transaction_id=$1',[tiny.transaction])).rows.length,0);
 await db.query('delete from storage.objects where name=$1',[f.documentPath]);assert.deepEqual(await save(firstIntent),first);
 for(const role of ['authenticated','service_role','anon']){await db.exec('set role '+role);await assert.rejects(save(firstIntent),/permission denied/);await db.exec('reset role');}
 assert.throws(()=>foreignClassificationAmount(125,{...incoming,classification:'Mixed',business_use_bps:3000},313),/expenses only/);
 assert.throws(()=>foreignClassificationIntent({...incoming,treatment_reviewed:false}));
});
