import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { bankValuationFixture, openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { parseBankValuationRevision } from '../lib/records/bank-valuation';
import { decryptSource, sourceContext, sourceHash } from '../lib/records/source-crypto';
import { verifyRetainedInvoiceBytes } from '../lib/fx/retained-source';
import { rateFromDecimal } from '../lib/fx/currency';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-bank-valuations-demo';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of migrations)await db.exec(await readFile(new URL(name,dir),'utf8'));
  const closed=async()=>{const r=(await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n;
   assert.equal(r,2);assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true);};
  await closed();await db.exec('begin');let result;
  try{
   // Test-only future representation is rolled back with all fixture/history writes.
   await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db),intent=await f.intent();
   const initial=parseBankValuationRevision(f.owner,await f.record(intent));
   assert.deepEqual(decryptSource(f.cipher,f.key,sourceContext(f.owner,f.account,f.hash)),f.sourceBytes);
   const verified=verifyRetainedInvoiceBytes(f.owner,{document_id:f.document,source_snapshot:{document_source:initial.source_snapshot.document_source}},
    {id:f.document,user_id:f.owner,file_hash:f.documentHash,media_type:'application/pdf',size_bytes:f.documentBytes.length,object_path:f.documentPath,key_id:'synthetic-v1'},f.documentCipher,f.key);
   const zeroIntent=await f.intent({expected_ordinal:1,data:{...intent.data,rate:rateFromDecimal('KWD','GBP','0.00001')}}),zero=parseBankValuationRevision(f.owner,await f.record(zeroIntent));
   await db.query('delete from storage.objects where name in($1,$2)',[f.path,f.documentPath]);
   assert.deepEqual(parseBankValuationRevision(f.owner,await f.record(zeroIntent)),zero);
   const withdrawn=parseBankValuationRevision(f.owner,await f.record(await f.intent({expected_ordinal:2,state:'withdrawn',transaction_version:null,document_id:null,data:null,human_read_original:false})));
   const positive=await bankValuationFixture(db,'JPY','1'),positiveSaved=parseBankValuationRevision(positive.owner,await positive.record(await positive.intent()));
   const effects=(await db.query<{records:number;settlements:number;decisions:number}>("select (select count(*)::int from financial_records) records,(select count(*)::int from invoice_settlements) settlements,(select count(*)::int from classification_decisions) decisions")).rows[0];
   assert.deepEqual(effects,{records:0,settlements:0,decisions:0});
   result={synthetic_only:true,migration_count:migrations.length,scope:'Private valuation history prerequisite; human-reviewed rate is not byte-proof, tax treatment or posting authorization.',foreign_admission_enabled:false,
    ciphertext_roundtrip_verified:true,source_sha256:sourceHash(f.sourceBytes),separate_document_byte_check:verified,
    initial,zero,withdrawn,positive:positiveSaved,source_loss_retry_exact:true,financial_effect_counts:effects,
    source_current_after_loss:(await db.query<{r:boolean}>('select bank_valuation_source_current($1,$2) r',[f.owner,zero.id])).rows[0].r};
   f.key.fill(0);positive.key.fill(0);
  }finally{await db.exec('rollback');}
  await closed();assert.equal((await db.query('select id from bank_valuation_revisions')).rows.length,0);
  await mkdir(output,{recursive:true});const body=JSON.stringify(result,null,2);await writeFile(output+'/valuations.json',body);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,artifact:'valuations.json',size_bytes:Buffer.byteLength(body),sha256:sourceHash(Buffer.from(body)),production_admission_still_closed:true,all_fixture_changes_rolled_back:true},null,2));
  await writeFile(output+'/README.md','# Synthetic private bank valuation demo\n\nAll ordered migrations run in a disposable database. Foreign-only test admission is opened inside one rolled-back transaction; actual GBP constraints and NOT NULL remain after it.\n\nKWD -10.001 values to GBP -25.00 at 2.5, then a successor rounds GBP zero, then withdrawal preserves history after source loss. JPY 1 at 0.005 values GBP 0.01 with the retained tie rule. Source encryption and a separate synthetic retained PDF byte check pass; the valuation recorder itself does not certify byte access or tax treatment. No classifications, financial records, settlements, provider calls, real data or hosted changes.\n');
  process.stdout.write('Synthetic private valuation artifacts: '+output+'\n');
 }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
