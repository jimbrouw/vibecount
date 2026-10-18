// Disposable real SQL, synthetic encrypted evidence, no public financial writer.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxConversionLotFixture } from '../lib/database/fx-lot-fixture';
import { authoritativeFxSettlementReview, fxSettlementChoices, parseFxSettlementCatalog } from '../lib/fx/settlement-catalog';
import { rateFromDecimal } from '../lib/fx/currency';
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migration='20261019020000_fx_settlement_catalog.sql';
  for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const x=await fxConversionLotFixture(db),{f}=x;await db.exec('reset role');await db.exec(await readFile(new URL(migration,dir),'utf8'));await db.exec(await readFile(new URL('20261019030000_fx_dependency_review.sql',dir),'utf8'));
  const read=async()=>{await f.auth();return parseFxSettlementCatalog(f.owner,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r);};
  const initial=await read(),reviews=[];
  for(const [original,cash]of [[5000,1250],[5000,1250],[1,0]]){
   const catalog=await read(),choice=fxSettlementChoices(catalog).find(c=>c.conversion_fact_revision_id===x.conversion)!;
   const preview=authoritativeFxSettlementReview(f.owner,{schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:catalog.financial_stamp,rationale:'Synthetic authoritative catalog review',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
    allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:original,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:choice.conversion_family_id,conversion_evidence_revision_id:x.conversion,conversion_lot_id:choice.lot_id??x.lot,conversion_lot_version:choice.lot_version}]},catalog);
   reviews.push(preview.result);await db.exec('reset role');await db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(preview.intent)]);
  }
  const allocated=await read();assert.equal(allocated.lots[0].active_count,3);assert.equal(allocated.lots[0].version,3);
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  const unavailable=await read();assert.equal(fxSettlementChoices(unavailable).find(c=>c.conversion_fact_revision_id===x.conversion)!.eligible,false);assert.equal(unavailable.lots[0].prior_invoice_minor,10001);
  await db.exec('reset role');await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[x.lot,unavailable.financial_stamp,'Synthetic complete reviewed reversal',randomUUID()]);
  const reversed=await read();assert.equal(reversed.lots[0].version,6);assert.equal(reversed.lots[0].active_count,0);
  await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r where bank_transaction_id=$1',[x.tx])).rows,x.before);
  const output='/tmp/vibecount-fx-settlement-catalog-demo';await mkdir(output,{recursive:true});
  await writeFile(output+'/catalog.json',JSON.stringify({synthetic_only:true,private_writers_only:true,initial,choices:fxSettlementChoices(initial),reviews,allocated,unavailable,reversed,recognized_income_unchanged:true},null,2)+'\n');
  await writeFile(output+'/README.md','# Authoritative FX catalog demo\n\nOne complete owned RPC supplies actual canonical/fact/receipt versions. Review first marks the UUID proposed, then reuses the persisted lot and database-derived all-event counters. KWD 10.001 is allocated against GBP 25.00 in three cumulative portions, including a final zero-cash event. Source-object loss blocks new allocation without hiding retained reversal ancestry. Complete private reversal leaves six events and zero active portions; recognised receipt bytes remain unchanged.\n\nOnly synthetic safe metadata is emitted. Financial writer grants stay private. This does not establish public human review, connected-source UX, dimensioned export integration, hosted Auth/PostgREST/Storage, foreign accounts or complete handover acceptance.\n');
  console.log('Verified authoritative owned FX catalog: '+output);
 }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
