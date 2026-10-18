import assert from 'node:assert/strict';
import test from 'node:test';
import { bankExportContext, type BankExportRow } from './bank-export-context';
import { bankSourceCoverageFixture, bankCoverageFixtureId as id } from './bank-source-coverage-fixture';
import { bankEvidenceLedger } from './bank-dimensioned-export';
import { bankReconciliationExport } from './reconciliation-bank-export';
import { sourceRecordEffects } from './source-export';
import { readSourceCsv } from './source-csv';

test('all-source exports retain outgoing, Personal and discarded observations and require exact receipt coverage',()=>{
  const coverage=bankSourceCoverageFixture(id(1),3);
  coverage.observations[1].signed_amount_pence='-100';coverage.observations[1].classification='Personal';
  coverage.observations[2].signed_amount_pence='-250';coverage.observations[2].import_status='discarded';
  const rows:BankExportRow[]=coverage.observations.map(r=>({id:r.id,user_id:id(1),account_id:r.account_id,import_id:r.import_id,transaction_date:r.cash_date,
    tax_year_start:r.tax_year_start,currency:r.currency,signed_amount_pence:r.signed_amount_pence,original_signed_minor:null,source_units_ruleset:null,
    classification:r.classification,dedupe_status:r.dedupe_status,decision_version:r.decision_version,business_use_bps:0,description:'=SUM(A1)',reference:'@private',
    record_imports:{id:r.import_id,user_id:id(1),source_file_id:id(30),file_hash:r.file_sha256,parser_version:r.parser_version},source_row_id:r.source_row_id,source_rows:{row_number:2,row_hash:r.row_sha256},record:[],refund_portions:[]}));
  const context=bankExportContext(id(1),coverage,rows,[],[]),result=bankEvidenceLedger(context,rows),[head,...csv]=readSourceCsv(result.csv);
  assert.equal(result.count,3);assert.equal(csv[1][head.indexOf('classification')],'Personal');assert.equal(csv[2][head.indexOf('import_status')],'discarded');
  assert.equal(csv[0][head.indexOf('description')],"'=SUM(A1)");
  assert.throws(()=>bankExportContext(id(1),coverage,rows.slice(0,2),[],[]));
  assert.throws(()=>bankReconciliationExport({owner:id(1),documents:[],facts:[],events:[],fx_lots:[],external_balances:[],legacy:[[],[],[]]},context),/receipt/);
  const receipt={id:rows[0].id,import_id:rows[0].import_id,transaction_date:rows[0].transaction_date,signed_amount_pence:100,allocated_pence:0,unallocated_pence:100,
    classification:'Unknown',record_status:null,active_transfer_id:null,active_refund_id:null,refunded_pence:0,source_row_id:rows[0].source_row_id,
    source_rows:{row_number:2,row_hash:'b'.repeat(64)},record_imports:{file_hash:'a'.repeat(64)}};
  const reconciliation=bankReconciliationExport({owner:id(1),documents:[],facts:[],events:[],fx_lots:[],external_balances:[],legacy:[[],[receipt],[]]},context);
  const [rh,...rr]=readSourceCsv(reconciliation.csv);
  assert.equal(rr.filter(r=>r[rh.indexOf('row_kind')]==='bank_source_observation').length,3);
  assert.equal(rr.find(r=>r[rh.indexOf('row_kind')]==='receipt_balance')![rh.indexOf('row_semantics')],'receipt allocation balance; source cash appears once in bank_source_observation; do not sum both');
  const foreign={...rows[0],currency:'KWD',signed_amount_pence:null,record:[{id:'effect',amount:'1.00',status:'approved'}]};
  assert.throws(()=>sourceRecordEffects(foreign),/explicit accounting bucket/);
  assert.equal(sourceRecordEffects({...foreign,record:[{...foreign.record[0],record_type:'expense'}]}).expensePence,100);
  const invalid=structuredClone(coverage);invalid.accounts[0].currency='USD';invalid.accounts[0].representation='foreign';
  Object.assign(invalid.counts,{native_accounts:0,foreign_accounts:1,native_observations:0,invalid_observations:3,active_blocked_observations:2});
  for(const r of invalid.observations){r.representation='invalid';r.valuation_status='invalid';}
  const invalidContext=bankExportContext(id(1),invalid,rows,[],[]),[ih,ir]=readSourceCsv(bankEvidenceLedger(invalidContext).csv);
  assert.equal(ir[ih.indexOf('actual_signed_gbp_pence')],'');assert.equal(ir[ih.indexOf('raw_signed_amount_pence')],'100');
});
