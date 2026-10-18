import assert from 'node:assert/strict';
import test from 'node:test';
import { bankSourceCoverageFixture, bankCoverageFixtureId as id } from './bank-source-coverage-fixture';
import { parseBankSourceCoverage } from './bank-source-coverage';
import { bankChoiceSource, nativeBankChoice, nativeBankIds, nativeDuplicateCohort, bankChoiceIndex } from './native-choice';
import { foreignTaxBankFixture } from '../tax/bank-source-fixture';
const bank=()=>parseBankSourceCoverage(bankSourceCoverageFixture(id(1),2),id(1));
function row(source:ReturnType<typeof bank>['observations'][number]){return{id:source.id,account_id:source.account_id,import_id:source.import_id,source_row_id:source.source_row_id,transaction_date:source.cash_date,currency:source.currency,signed_amount_pence:source.signed_amount_pence,original_signed_minor:source.original_signed_minor,source_units_ruleset:source.ruleset_id,decision_version:source.decision_version,classification:source.classification,dedupe_status:source.dedupe_status,import_status:source.import_status,file_hash:source.file_sha256!,row_hash:source.row_sha256!,parser_version:source.parser_version!}}
test('native choices require exact source identity and safe cash without weakening retained source-loss cleanup',()=>{
 const b=bank(),r=row(b.observations[0]);assert.equal(nativeBankChoice(b,r),true);assert.deepEqual(bankChoiceSource(bankChoiceIndex(b),r),b.observations[0]);b.observations[0].source_available=false;assert.equal(nativeBankChoice(b,r),true);
 for(const patch of [{id:id(99)},{account_id:id(9)},{import_id:id(9)},{source_row_id:id(9)},{transaction_date:'2025-04-05'},{currency:'USD'},{signed_amount_pence:null},{signed_amount_pence:0},{signed_amount_pence:'1e2'},{decision_version:1},{classification:'Personal'},{import_status:'discarded'},{source_units_ruleset:'forged'},{original_signed_minor:'100'},{user_id:id(2)},{file_hash:'c'.repeat(64)},{row_hash:'c'.repeat(64)},{parser_version:'other'}])assert.throws(()=>bankChoiceSource(b,{...r,...patch}));
 const missing={...r}as Partial<typeof r>;delete missing.currency;assert.throws(()=>bankChoiceSource(b,missing as typeof r));
 assert.throws(()=>nativeBankIds(b,[id(999)]));assert.throws(()=>nativeBankIds(b,[r.id,r.id]));
});
test('foreign and invalid account representations remain explicit unsupported choices with exact original units',()=>{
 const f=foreignTaxBankFixture(),r=row(f.observations[0]);assert.equal(nativeBankChoice(f,r),false);assert.equal(bankChoiceSource(f,r).original_signed_minor,'10001');assert.equal(bankChoiceSource(f,r).signed_amount_pence,null);
 const zero=bank();for(const s of zero.observations){s.signed_amount_pence='0';s.representation='invalid';s.valuation_status='invalid'}Object.assign(zero.counts,{native_observations:0,invalid_observations:2,active_blocked_observations:2});const parsedZero=parseBankSourceCoverage(zero,id(1));assert.equal(nativeBankChoice(parsedZero,row(parsedZero.observations[0])),false);
 const b=bank();b.accounts[0].currency='USD';b.accounts[0].representation='foreign';b.counts.foreign_accounts=1;b.counts.native_accounts=0;b.counts.native_observations=0;b.counts.invalid_observations=2;b.counts.active_blocked_observations=2;
 for(const s of b.observations){s.source_complete=false;s.representation='invalid';s.valuation_status='invalid'}const raw=parseBankSourceCoverage(b,id(1));assert.equal(nativeBankChoice(raw,row(raw.observations[0])),false);
});
test('complete duplicate cohorts retain unsupported peers and reject omitted, repeated or inconsistent groups',()=>{
 const b=bank(),rows=b.observations.map(s=>({...row(s),account_id:s.account_id,fingerprint:'a'.repeat(64),peer_count:1}));assert.equal(nativeDuplicateCohort(b,rows,rows[0].id),true);
 for(const values of [[rows[0]], [...rows,rows[0]], [rows[0],{...rows[1],fingerprint:'b'.repeat(64)}], [rows[0],{...rows[1],peer_count:2}]])assert.throws(()=>nativeDuplicateCohort(b,values,rows[0].id));
 b.observations[1].representation='invalid';assert.equal(nativeDuplicateCohort(b,rows,rows[0].id),false);assert.equal(rows.length,2);
});
