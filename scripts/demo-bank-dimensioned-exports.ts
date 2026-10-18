// Synthetic disposable SQL only. No hosted operations or real financial approvals.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { bankValuationFixture, openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { bankExportContext, type BankExportRow, type BankExportFamily } from '../lib/records/bank-export-context';
import { bankEvidenceLedger, bankEvidenceManifest } from '../lib/records/bank-dimensioned-export';
import { bankReconciliationExport } from '../lib/records/reconciliation-bank-export';
import { FX_PROVENANCE_SCHEMA, FX_PROVENANCE_SCOPE } from '../lib/fx/provenance';
import { canonicalJson, sha256 } from '../lib/tax/snapshot';
import { rateFromDecimal } from '../lib/fx/currency';
async function main(){
 const output='/tmp/vibecount-bank-dimensioned-exports-demo',db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  await db.exec('begin');await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
  await f.record(await f.intent({state:'provisional',human_read_original:false}));
  await f.record(await f.intent({expected_ordinal:1,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
  const coverage=(await db.query<{c:unknown}>('select read_bank_source_coverage() c')).rows[0].c;
  const rows=(await db.query<{r:BankExportRow}>(`select to_jsonb(t)||jsonb_build_object('source_rows',jsonb_build_object('row_number',s.row_number,'row_hash',s.row_hash),'record_imports',jsonb_build_object('id',i.id,'user_id',i.user_id,'source_file_id',i.source_file_id,'file_hash',i.file_hash,'parser_version',i.parser_version),'record','[]'::jsonb,'refund_portions','[]'::jsonb) r from bank_transactions t join source_rows s on s.id=t.source_row_id join record_imports i on i.id=t.import_id where t.user_id=$1`,[f.owner])).rows.map(r=>r.r);
  const families=(await db.query<BankExportFamily>('select id,user_id,transaction_id from bank_valuation_families where user_id=$1',[f.owner])).rows;
  const revisions=(await db.query<{r:unknown}>('select to_jsonb(v) r from bank_valuation_revisions v where user_id=$1 order by ordinal',[f.owner])).rows.map(r=>r.r);
  const selected=bankExportContext(f.owner,coverage,rows,families,revisions,f.imported),all=bankExportContext(f.owner,coverage,rows,families,revisions);
  const ledger=bankEvidenceLedger(selected,rows),manifest=bankEvidenceManifest(f.owner,selected,{schema_version:FX_PROVENANCE_SCHEMA,scope:FX_PROVENANCE_SCOPE,owner_id:f.owner,counts:{lots:0,events:0},lots:[],events:[]});
  const reconciliation=bankReconciliationExport({owner:f.owner,documents:[],facts:[],events:[],fx_lots:[],external_balances:[],legacy:[[],[],[]]},all);
  assert.equal(selected.snapshot.observations[0].valuation_status,'reviewed_zero');assert.equal(selected.snapshot.observations[0].original_signed_minor,'-10001');
  assert.equal(selected.snapshot.observations[0].signed_amount_pence,null);assert.equal(selected.snapshot.recognized_expense_pence,0);
  assert.equal(manifest.snapshot_sha256,sha256(canonicalJson(manifest.snapshot)));
  assert.equal((await db.query('select id from financial_records')).rows.length,0);
  await db.exec('rollback');assert.equal((await db.query('select id from bank_transactions')).rows.length,0);
  const constraints=(await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n;assert.equal(constraints,2);
  await mkdir(output,{recursive:true});const files=[['ledger.csv',ledger.csv],['evidence-manifest.json',JSON.stringify(manifest,null,2)],['reconciliation.csv',reconciliation.csv],['report.json',JSON.stringify({synthetic_only:true,rolled_back:true,admission_guards_restored:true,original_currency:'KWD',original_signed_minor:-10001,actual_gbp_cash:null,retained_valuation_revisions:2,reviewed_valuation_gbp_pence:0,recognized_expense_pence:0,current_document_metadata:'not captured by this pure serializer demo; current routes additionally bracket the evidence catalog'},null,2)]];
  const hashes=[];for(const[name,body]of files){await writeFile(output+'/'+name,body);hashes.push({name,size_bytes:Buffer.byteLength(body),sha256:sha256(body)})}
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,files:hashes},null,2));console.log(JSON.stringify({output,files:files.length,rolled_back:true}));
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
