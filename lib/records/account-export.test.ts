import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ACCOUNT_EXPORT_SCHEMA, buildAccountExport, parseAccountExportContext, serializeAccountExport } from './account-export';
import { accountExportFixture } from './account-export-fixture';
import { canonicalJson } from '../tax/snapshot';
import { FX_CURRENCY_RULESET } from '../fx/currency';
test('partial account data has explicit scope, exact money, safe nested projection and a reproducible data hash',()=>{
 const f=accountExportFixture(),before=JSON.stringify(f.raw),out=buildAccountExport(f.owner,f.raw,f.context),body=serializeAccountExport(out);
 assert.equal(out.schema_version,ACCOUNT_EXPORT_SCHEMA);assert.equal(out.data.invoices[0].amount,'120.00');assert.equal(out.data.financialRecords[0].amount,'30.01');assert.equal(out.data.financialRecords[0].effect_sign,-1);assert.equal(out.data.settings[0].vat_rate,'0.00');assert.equal(out.data.invoiceReminders[0].amount_due_pence,'9000');assert.equal(out.data.invoiceRevisions[0].pdf_sha256,'a'.repeat(64));
 assert.doesNotMatch(body,/PRIVATE_|12-34-56|12345678/);assert.match(String(out.data.invoices[0].description),/redacted/);assert.match(out.scope,/not a restorable/);assert.equal(JSON.stringify(f.raw),before);
 assert.equal(out.data_sha256,createHash('sha256').update(canonicalJson(out.data)).digest('hex'));assert.equal(out.data.invoices[0].source_fact_revision_id,null);
});
test('account export preserves external original units and null GBP compatibility without inventing evidence completeness',()=>{
 for(const [currency,minor] of [['USD',12345],['GBP',12345],['JPY',123],['KWD',12345]] as const){
  const f=accountExportFixture();Object.assign(f.raw.invoices[0],{origin:'preserved_external',currency,amount:null,original_total_minor:minor,currency_ruleset_id:FX_CURRENCY_RULESET,source_fact_revision_id:'22222222-2222-4222-8222-222222222222',source_fact_family_id:'33333333-3333-4333-8333-333333333333'});
  const out=buildAccountExport(f.owner,f.raw,f.context);assert.equal(out.data.invoices[0].amount,null);assert.equal(out.data.invoices[0].original_total_minor,String(minor));assert.equal(out.data.invoices[0].currency,currency);assert.match(out.financial_meaning,/not certified/);
 }
});
test('missing, duplicated, foreign or malformed export fields and counts withhold the output',()=>{
 for(const mutate of [
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.clients=[]},
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.invoices[0].user_id='other'},
  (f:ReturnType<typeof accountExportFixture>)=>{delete f.raw.invoices[0].currency},
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.invoices[0].amount=null},
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.clients[0].name={raw:'PRIVATE'}},
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.invoices.push(f.raw.invoices[0]);f.context.counts.invoices=2},
  (f:ReturnType<typeof accountExportFixture>)=>{f.raw.financialRecords[0].amount=1e30},
 ]){const f=accountExportFixture();mutate(f);assert.throws(()=>buildAccountExport(f.owner,f.raw,f.context));}
 const f=accountExportFixture(),value={schema_version:'vibecount.partial-account-context/1',owner_id:f.owner,...f.context};assert.deepEqual(parseAccountExportContext(f.owner,value),f.context);
 for(const patch of [{owner_id:'other'},{stamp:'a'.repeat(64)+'\n'},{counts:{...f.context.counts,settings:2}},{counts:{}},{schema_version:'unknown'}])assert.throws(()=>parseAccountExportContext(f.owner,{...value,...patch}));
});
test('partial account direct-download limit never emits a truncated JSON artifact',()=>{
 const f=accountExportFixture();f.raw.clients[0].name='x'.repeat(4_000_000);assert.throws(()=>serializeAccountExport(buildAccountExport(f.owner,f.raw,f.context)),/capacity/);
});
