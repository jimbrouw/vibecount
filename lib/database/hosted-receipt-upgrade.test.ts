import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rehearseHostedUpgrade} from '../../scripts/rehearse-hosted-upgrade';

test('hosted receipt upgrade preserves history, cash reporting, refund signs and owner isolation',async t=>{
 const output=await mkdtemp(join(tmpdir(),'vibecount-hosted-upgrade-'));
 t.after(()=>rm(output,{recursive:true,force:true}));
 const report=await rehearseHostedUpgrade(output);
 assert.equal(report.passed,true);
 assert.equal(report.receipt_rows_preserved,3);
 assert.ok(report.applied.includes('20261014115320_receipt_review_lock.sql'));
 assert.ok(report.applied.includes('20261020160000_receipt_cash_reporting_compatibility.sql'));
 assert.ok(report.applied.includes('20261020170000_receipt_operational_review.sql'));
 assert.ok(report.applied.includes('20261020180000_receipt_tax_source_provenance.sql'));
 assert.ok(report.applied.includes('20261020190000_receipt_tax_calculation_input.sql'));
 assert.ok(report.applied.includes('20261020200000_record_cash_computed_fields.sql'));
 assert.ok(report.applied.includes('20261020210000_receipt_refund_integrity.sql'));
});
