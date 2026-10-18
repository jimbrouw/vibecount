import assert from 'node:assert/strict';
import test from 'node:test';
import {currentFinancialReviewFixture,financialReviewFixture} from './financial-review-fixture';
import {parseCurrentFinancialReview,parseFinancialReview,readFinancialReview,financialReviewPrompt,financialReviewBankSummary} from './financial-review';
import {financialReviewPrompt as legacyPrompt} from './financial-review-v1';
import {bankCoverageFixtureId as id} from './bank-source-coverage-fixture';

test('current review requires V2 while explicit V1 replay and provider serialization remain unchanged',async()=>{
 const old=financialReviewFixture(),legacy=parseFinancialReview(old.owner,old.year,old.asOf,old.catalog);
 assert.equal(legacy.schema_version,'vibecount.financial-review/1');assert.equal(financialReviewPrompt(legacy),legacyPrompt(legacy));
 await assert.rejects(readFinancialReview({rpc:async()=>({data:old.catalog,error:null})},old.owner,old.year,old.asOf),/version/);
 const f=currentFinancialReviewFixture(),r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,f.catalog);
 assert.equal(r.source_count,4);assert.equal(r.unsupported_source_count,0);assert.equal(r.quarters[0].net_pence,25000);
 assert.equal(r.bank_source_coverage.observations.length,4);assert.doesNotMatch(financialReviewPrompt(r),/PRIVATE_|00000000|11111111|file_sha256|row_sha256|valuation_status|bank_source_coverage|parser_version/);
 assert.deepEqual(parseCurrentFinancialReview(f.owner,f.year,f.asOf,r),r);
});

function unsupportedFixture(){
 const f=currentFinancialReviewFixture(),c=f.catalog,b=c.bank_source_coverage;
 b.accounts.push({id:id(21),currency:'KWD',representation:'foreign'});b.counts.accounts++;b.counts.foreign_accounts++;
 b.observations[0]={...b.observations[0],account_id:id(21),currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',ruleset_id:'vibecount-currencies/1',parser_version:'mapped-csv/2',representation:'foreign',valuation_status:'unvalued'};
 b.counts.native_observations--;b.counts.foreign_observations++;b.counts.active_blocked_observations++;c.unsupported_source_count=1;c.quarters[0].unsupported_source_count=1;
 return f;
}
test('unsupported and unavailable sources overlap without disappearing or changing GBP ledger money',()=>{
 const f=unsupportedFixture(),c=f.catalog,b=c.bank_source_coverage;
 b.observations[0].source_available=false;c.source_unavailable_count=1;c.quarters[0].source_unavailable_count=1;
 let r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,c);assert.equal(r.unresolved_source_count,1);assert.equal(r.unsupported_source_count,1);assert.equal(r.source_unavailable_count,1);assert.equal(r.quarters[0].net_pence,25000);
 b.observations[1].source_available=false;c.source_unavailable_count=2;c.quarters[0].source_unavailable_count=2;c.unresolved_source_count=2;c.quarters[0].unresolved_source_count=2;
 r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,c);assert.equal(r.source_unavailable_count,2);assert.equal(r.unsupported_source_count,1);
 for(const patch of [{source_count:3},{unsupported_source_count:0},{source_unavailable_count:0},{unresolved_source_count:0}])assert.throws(()=>parseCurrentFinancialReview(f.owner,f.year,f.asOf,{...c,...patch}));
 assert.throws(()=>parseCurrentFinancialReview(f.owner,f.year,f.asOf,{...c,quarters:c.quarters.map((q,i)=>i===0?{...q,source_unavailable_count:0}:q)}));
});
test('discarded and other-year sources remain owner context but cannot inflate active-year counters',()=>{
 const f=unsupportedFixture(),c=f.catalog,b=c.bank_source_coverage;
 b.observations[0].import_status='discarded';b.counts.active_blocked_observations=0;c.source_count=3;c.unsupported_source_count=0;c.unresolved_source_count=0;c.quarters[0].source_count=3;c.quarters[0].unsupported_source_count=0;c.quarters[0].unresolved_source_count=0;
 let r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,c);assert.equal(r.bank_source_coverage.counts.foreign_observations,1);assert.equal(r.unsupported_source_count,0);
 b.observations[0].import_status='review';b.counts.active_blocked_observations=1;b.observations[0].cash_date=`${f.year}-04-05`;b.observations[0].tax_year_start=f.year-1;
 r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,c);assert.equal(r.source_count,3);assert.equal(financialReviewBankSummary(r).preserved_observations,4);
});
test('arbitrary invalid currency metadata cannot enter aggregate provider sharing',()=>{
 const f=unsupportedFixture(),c=f.catalog,b=c.bank_source_coverage;
 b.accounts[1].currency='PRIVATE';b.accounts[1].representation='invalid';b.counts.foreign_accounts--;b.counts.invalid_accounts++;
 b.observations[0].currency='PRIVATE';b.observations[0].representation='invalid';b.observations[0].valuation_status='invalid';b.counts.foreign_observations--;b.counts.invalid_observations++;
 const r=parseCurrentFinancialReview(f.owner,f.year,f.asOf,c),preview=financialReviewBankSummary(r),prompt=financialReviewPrompt(r);
 assert.deepEqual(preview.original_currency_observation_groups,[{currency:'GBP',observation_count:3},{currency:'invalid',observation_count:1}]);assert.doesNotMatch(prompt,/PRIVATE|00000000|file_sha256|original_signed_minor/);assert.match(prompt,/"currency":"invalid"/);
});
test('cash quarter boundaries, missing import closure and conflicting invoice aliases cannot hide review work',()=>{
 const f=currentFinancialReviewFixture(),c=f.catalog;
 const dates=[`${f.year}-07-05`,`${f.year}-07-06`,`${f.year}-10-06`,`${f.year+1}-01-06`];
 c.bank_source_coverage.observations.forEach((r,i)=>{r.cash_date=dates[i]});c.quarters.forEach(q=>{q.source_count=1});
 assert.deepEqual(parseCurrentFinancialReview(f.owner,f.year,f.asOf,c).quarters.map(q=>q.source_count),[1,1,1,1]);
 c.bank_source_coverage.observations[0].cash_date=`${f.year}-10-05`;
 assert.throws(()=>parseCurrentFinancialReview(f.owner,f.year,f.asOf,c));
 c.quarters[0].source_count=0;c.quarters[1].source_count=2;c.quarters[0].unresolved_source_count=0;c.quarters[1].unresolved_source_count=1;
 assert.deepEqual(parseCurrentFinancialReview(f.owner,f.year,f.asOf,c).quarters.map(q=>q.source_count),[0,2,1,1]);
 const g=currentFinancialReviewFixture(),b=g.catalog.bank_source_coverage,r=b.observations[0];
 r.import_status=null;r.source_complete=false;r.source_available=false;r.representation='invalid';r.valuation_status='invalid';b.counts.native_observations--;b.counts.invalid_observations++;b.counts.active_blocked_observations++;
 g.catalog.unsupported_source_count=1;g.catalog.source_unavailable_count=1;g.catalog.quarters[0].unsupported_source_count=1;g.catalog.quarters[0].source_unavailable_count=1;
 assert.equal(parseCurrentFinancialReview(g.owner,g.year,g.asOf,g.catalog).source_count,4);
 const normal=currentFinancialReviewFixture();assert.throws(()=>parseCurrentFinancialReview(normal.owner,normal.year,normal.asOf,{...normal.catalog,overdue_invoices:normal.catalog.overdue_invoices.map(i=>({...i,original_pence:12001}))}),/aliases/);
});

test('receipt cash exclusions stay visible in human and provider samples with validated reasons',()=>{
 const f=currentFinancialReviewFixture();
 for(const treatment of ['unpaid','unsupported_currency']){
  const catalog={...f.catalog,recent_records:f.catalog.recent_records.map((r,i)=>i===0?{...r,amount_pence:'0',cash_treatment:treatment}:r)};
  const review=parseCurrentFinancialReview(f.owner,f.year,f.asOf,catalog);
  assert.match(review.recent_records[0].label,/excluded from .*cash totals/);
  assert.match(financialReviewPrompt(review),/excluded from .*cash totals/);
  assert.deepEqual(parseCurrentFinancialReview(f.owner,f.year,f.asOf,review),review);
  assert.throws(()=>parseCurrentFinancialReview(f.owner,f.year,f.asOf,{...catalog,recent_records:catalog.recent_records.map((r,i)=>i===0?{...r,amount_pence:'100'}:r)}),/cash treatment/);
 }
 assert.throws(()=>parseCurrentFinancialReview(f.owner,f.year,f.asOf,{...f.catalog,recent_records:f.catalog.recent_records.map(r=>({...r,cash_treatment:'PRIVATE_MERCHANT'}))}),/cash treatment/);
});
