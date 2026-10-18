// Disposable ordered SQL and synthetic evidence only. Financial RPCs stay private.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxConversionLotFixture } from '../lib/database/fx-lot-fixture';
import { validateFxSettlementIntent } from '../lib/fx/settlement';
import { rateFromDecimal } from '../lib/fx/currency';
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migration='20261019010000_dimensioned_fx_settlements.sql';
  for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const x=await fxConversionLotFixture(db),{f}=x;await db.exec('reset role');await db.exec(await readFile(new URL(migration,dir),'utf8'));
  const stamp=async()=>{await f.auth();return(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;};
  const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[x.conversion])).rows[0].family_id;
  const inputs=[],results=[];
  for(const [version,units,cash]of [[0,5000,1250],[1,5000,1250],[2,1,0]]){
   const i=validateFxSettlementIntent({schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:await stamp(),rationale:'Synthetic reviewed document conversion',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
    allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:units,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:family,conversion_evidence_revision_id:x.conversion,conversion_lot_id:x.lot,conversion_lot_version:version}]});
   inputs.push(i);await db.exec('reset role');results.push((await db.query<{r:unknown}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(i)])).rows[0].r);
  }
  await f.auth();const receipt=(await db.query<{allocated_pence:string|number;unallocated_pence:string|number}>('select allocated_pence,unallocated_pence from receipt_allocation_balances where id=$1',[x.tx])).rows[0];assert.equal(Number(receipt.allocated_pence),2500);assert.equal(Number(receipt.unallocated_pence),1);
  const active=(await db.query<{invoice_minor:string|number;amount_pence:string|number;lot_event_ordinal:number}>('select invoice_minor,amount_pence,lot_event_ordinal from active_dimensioned_invoice_allocations where conversion_lot_id=$1 order by lot_event_ordinal',[x.lot])).rows;assert.equal(active.length,3);assert.equal(Number(active[2].amount_pence),0);
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  const historical=(await db.query<{r:unknown}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(inputs[0])])).rows[0].r;assert.deepEqual(historical,results[0]);
  const reviewedStamp=await stamp();await db.exec('reset role');const args=[x.lot,reviewedStamp,'Synthetic complete reversal after source loss',randomUUID()];
  const reversed=(await db.query<{r:{released_invoice_minor:number;released_cash_pence:number}}>('select reverse_fx_conversion_lot($1,$2,$3,$4) r',args)).rows[0].r;assert.equal(reversed.released_invoice_minor,10001);assert.equal(reversed.released_cash_pence,2500);
  assert.deepEqual((await db.query<{r:unknown}>('select reverse_fx_conversion_lot($1,$2,$3,$4) r',args)).rows[0].r,reversed);
  assert.equal((await db.query('select id from active_invoice_allocations where invoice_id=$1',[x.intent.invoice_id])).rows.length,0);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1',[x.tx])).rows,x.before);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(i) r from invoices i where id=$1',[f.native])).rows[0].r,f.nativeRow);
  const output='/tmp/vibecount-fx-settlement-demo';await mkdir(output,{recursive:true});await writeFile(output+'/settlements.json',JSON.stringify({synthetic_only:true,private_rpc_only:true,results,active_before_reversal:active,receipt_before_reversal:receipt,historical,reversed,recognized_income_unchanged:true,native_parity:true},null,2)+'\n');
  await writeFile(output+'/README.md','# Private dimensioned FX settlement demo\n\nActual ordered SQL links KWD 10.001 original entitlement to GBP 25.00 of a previously approved GBP 25.01 receipt. Three cumulative portions retain a final positive-original/zero-cash allocation. Receipt capacity leaves GBP 0.01 unallocated; matching creates no new income. After synthetic source-object loss, exact approval recovery stays historical and complete descending lot reversal releases both capacities, preserving all original snapshots and the recognised receipt bytes. Native row values remain unchanged.\n\nOnly safe metadata is emitted. The fixture uses real encryption of synthetic invoice bytes and synthetic bank metadata. RPCs remain private and no public financial matching UI is enabled. This is not full catalog/export integration, hosted Auth/Storage, actual human source review, foreign accounts, fees, refunds, tax certification or release acceptance. No real financial approval, provider call, send, payment, hosted migration, deployment or filing occurs.\n');
  console.log('Verified private dimensioned FX settlement/reversal: '+output);
 }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
