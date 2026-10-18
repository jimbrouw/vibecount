import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFinancialReview,financialReviewPrompt } from './financial-review';
import { financialReviewFixture } from './financial-review-fixture';
test('financial review keeps complete counts, signed GBP totals, actual outstanding and explicitly limited examples',()=>{
 const f=financialReviewFixture(),r=parseFinancialReview(f.owner,f.year,f.asOf,f.catalog);assert.equal(r.approved_count,27);assert.equal(r.recent_records.length,20);assert.equal(r.quarters[0].net_pence,25000);assert.equal(r.recent_records[19].amount_pence,-1000);assert.equal(r.overdue_invoices[0].outstanding_pence,4000);assert.equal(r.overdue_invoices[0].original_pence,12000);assert.equal(r.external_invoice_count,1);assert.equal(r.unresolved_source_count,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
 const prompt=financialReviewPrompt(r);assert.doesNotMatch(prompt,/PRIVATE_|11111111|record-0|"id"/);assert.match(prompt,/"outstanding_pence":4000/);assert.match(prompt,/"currency":"USD"/);assert.match(prompt,/source_and_tax_completeness_not_certified/);
});
test('currency groups retain GBP, JPY and KWD original units without implied foreign settlement',()=>{
 for(const currency of ['GBP','JPY','KWD']){const f=financialReviewFixture();f.catalog.invoice_groups[1]={currency,original_total_minor:'12345',invoice_count:1};if(currency==='GBP')f.catalog.invoice_groups=[{currency,original_total_minor:'24345',invoice_count:2}];assert.equal(parseFinancialReview(f.owner,f.year,f.asOf,f.catalog).external_invoice_count,1)}
});
test('missing counts, malformed native units, inconsistent arithmetic, oversized samples and foreign contexts reject',()=>{
 for(const mutate of [
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.owner_id='other'},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.quarters[0].net_pence='0'},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.recent_records=[]},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.overdue_invoices[0].outstanding_pence='0'},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.overdue_invoices[0].outstanding_pence='12001'},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.unresolved_source_count=5},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.invoice_groups[1].currency='CAD'},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.recent_records[1].id=f.catalog.recent_records[0].id},
  (f:ReturnType<typeof financialReviewFixture>)=>{f.catalog.stamp+='\n'},
 ]){const f=financialReviewFixture();mutate(f);assert.throws(()=>parseFinancialReview(f.owner,f.year,f.asOf,f.catalog));}
});
