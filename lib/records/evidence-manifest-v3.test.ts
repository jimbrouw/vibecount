import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evidenceManifest } from './evidence-manifest';
import { evidenceManifestV3 } from './evidence-manifest-v3';
import type { SourceExportRow } from './source-export';
import { fxProvenanceFixture } from '../fx/provenance-fixture';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('frozen V2 source manifest bytes and hashes remain unchanged',()=>{
  const frozen=JSON.parse(readFileSync(new URL('../../fixtures/evidence-manifest-v2-frozen.json',import.meta.url),'utf8'));
  const body=JSON.stringify(evidenceManifest(frozen.source,frozen.account,frozen.rows));
  assert.equal(body,frozen.body);assert.equal(createHash('sha256').update(body).digest('hex'),frozen.sha256);
});
test('manifest V3 retains unchanged accounting snapshot and separately hashed complete FX relationship context',()=>{
  const f=fxProvenanceFixture(),s=f.sources[0],source={id:s.import_id,file_hash:s.file_hash,parser_version:'mapped-csv/1',account_id:'synthetic',status:'review',created_at:'2026-10-18',coverage_start:null,coverage_end:null};
  const row:SourceExportRow={...s,description:'PRIVATE DESCRIPTION',reference:'PRIVATE REFERENCE',business_use_bps:10000,tax_year_start:2026,source_rows:{row_number:2,row_hash:s.row_hash},record:{id:'record',amount:'25.01',record_type:'income',effect_sign:1,status:'approved'}};
  const account={label:'Synthetic',masked_identifier:'1234'},old=evidenceManifest(source,account,[row]),result=evidenceManifestV3(f.owner,source,account,[row],f.raw);
  assert.equal(result.schema_version,'vibecount.evidence-manifest/3');assert.equal(result.source_snapshot_sha256,old.snapshot_sha256);
  const {fx_provenance,...base}=result.snapshot;assert.deepEqual(base,old.snapshot);
  assert.equal(result.fx_provenance_sha256,hash(fx_provenance));assert.equal(result.snapshot_sha256,hash(result.snapshot));
  assert.equal(result.snapshot.recognized_income_pence,'2501');assert.equal(result.snapshot.fx_provenance.events.length,3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.throws(()=>evidenceManifestV3(f.owner,{...source,id:'wrong-import'},account,[row],f.raw),/source observation/);
});
