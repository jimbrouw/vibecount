import { accountingTaxPackFixture } from './bank-source-fixture';
import { packFixture, reviewFixture, acknowledge } from './filing-pack-fixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCalculation, canonicalJson, sha256 } from './snapshot.ts';
import { buildFilingPack, buildFilingReview, validateStepData, verifyFilingPack, type SavedFilingPack } from './filing-pack.ts';
test('all seven outputs share frozen inputs, exact artifact hashes and explicit draft status', () => {
    const input = packFixture(), reviews = reviewFixture(input), bundle = buildFilingPack(input, reviews, 'synthetic-request', true);
    assert.equal(bundle.review_status, 'draft_reviewed');
    assert.equal(bundle.artifacts.length, 7);
    assert.equal(new Set(bundle.artifacts.map(a => a.name)).size, 7);
    assert.equal(bundle.blocking_issues.length, 0);
    for (const artifact of bundle.artifacts) {
        assert.equal(sha256(artifact.body), artifact.sha256);
        assert.equal(Buffer.byteLength(artifact.body), artifact.size_bytes);
        assert.ok(artifact.body.includes(bundle.input_sha256));
        assert.ok(artifact.body.includes('Draft — not submitted to HMRC'));
        if (artifact.name.endsWith('.csv')) {
            assert.ok(artifact.body.includes('\r\n'));
            assert.ok(!artifact.body.includes(String.raw `\r\n`));
        }
    }
    const row: SavedFilingPack = { id: 'pack', tax_year_start: 2025, input, input_canonical_json: canonicalJson(input), input_sha256: bundle.input_sha256, bundle, bundle_canonical_json: canonicalJson(bundle), bundle_sha256: sha256(canonicalJson(bundle)), reason: 'Synthetic', author: 'owner', created_at: '2026-10-18', request_id: 'synthetic-request' };
    assert.equal(verifyFilingPack(row).artifacts[0].name, 'worksheet.html');
    assert.throws(() => verifyFilingPack({ ...row, bundle_sha256: '0'.repeat(64) }), /integrity/);
    assert.equal(canonicalJson(buildFilingPack(input, reviews, 'synthetic-request', true)), row.bundle_canonical_json);
    const worksheet = buildFilingReview(input, reviews).worksheet;
    assert.equal(worksheet.find(r => r.id === 'trade-expenses')!.pence, 18909);
    assert.equal(worksheet.find(r => r.id === 'trade-expenses')!.paper_pounds, 190);
    assert.equal(worksheet.find(r => r.id === 'taxable-profit')!.paper_pounds, null);
});
test('source and step changes invalidate only relevant review digests and prohibit false completeness', () => {
    const input = packFixture(), reviews = reviewFixture(input), before = buildFilingReview(input, reviews);
    input.documents.push({ id: 'new-evidence', file_hash: 'a'.repeat(64), media_type: 'application/pdf', size_bytes: 100, created_at: '2026-10-18' });
    const after = buildFilingReview(input, reviews);
    assert.equal(before.canAttest, true);
    assert.equal(after.steps.find(s => s.id === 'profile')!.review?.id, before.steps.find(s => s.id === 'profile')!.review?.id);
    assert.equal(after.steps.find(s => s.id === 'income')!.review?.id, before.steps.find(s => s.id === 'income')!.review?.id);
    assert.equal(after.steps.find(s => s.id === 'sources')!.review, null);
    assert.equal(after.canAttest, false);
    assert.throws(() => buildFilingPack(input, reviews, 'request', true), /completeness/);
    assert.equal(buildFilingPack(input, reviews, 'request', false).review_status, 'draft_incomplete');
    input.calculation_is_current = false;
    assert.throws(() => buildFilingPack(input, reviews, 'request', false), /current calculation/);
});
test('unmatched cash needs a digest-bound explicit no-invoice review; cross-year context contributes zero', () => {
    const input = packFixture();
    input.observations.push({ id: 'receipt', source_row_id: 'row1', import_id: 'import1', account_id: 'account', masked_identifier: '0000', in_tax_year: true, record_type: 'income', file_hash: 'a'.repeat(64), row_hash: 'b'.repeat(64), row_number: 2, transaction_date: '2025-08-01', signed_amount_pence: 150000, classification: 'Business' });
    input.receipt_balances.push({ id: 'receipt', in_tax_year: true, record_status: 'approved', classification: 'Business', unallocated_pence: 150000, signed_amount_pence: 150000 });
    input.observations.push({ id: 'prior-original', source_row_id: 'row2', import_id: 'import2', account_id: 'account', masked_identifier: '0000', in_tax_year: false, record_type: 'income', file_hash: 'c'.repeat(64), row_hash: 'd'.repeat(64), row_number: 2, signed_amount_pence: 99999999, transaction_date: '2024-08-01' });
    const reviews = reviewFixture(input);
    assert.ok(buildFilingReview(input, reviews).issues.some(i => i.code === 'unmatched_receipt'));
    acknowledge(input, 'income', reviews, { all_receipts_are_turnover: true, no_invoice_expected_ids: ['receipt'] });
    assert.ok(!buildFilingReview(input, reviews).issues.some(i => i.code === 'unmatched_receipt'));
    const ledger = buildFilingPack(input, reviews, 'request', false).artifacts.find(a => a.name === 'normalized-ledger.csv')!.body;
    assert.ok(ledger.includes('99999999'));
    assert.ok(ledger.includes('prior-original'));
    assert.ok(!ledger.includes('[redacted account number]'));
    input.receipt_balances[0].unallocated_pence = 50000;
    assert.ok(buildFilingReview(input, reviews).issues.some(i => i.code === 'unmatched_receipt'));
    assert.throws(() => validateStepData(input, 'income', { all_receipts_are_turnover: true, no_invoice_expected_ids: ['foreign'] }), /current unmatched/);
});
test('HTML and CSV escape user-controlled content while preserving amounts, hashes and identifiers', () => {
    const input = packFixture();
    input.calculation.input.records[1].category!.name = '<script>alert(1)</script>';
    const p = prepareCalculation(input.calculation.input);
    Object.assign(input.calculation, { input_canonical_json: p.inputJson, input_sha256: p.inputHash, result: p.result, result_canonical_json: p.resultJson, result_sha256: p.resultHash });
    input.classifications.push({ id: '11111111-1111-4111-8111-111111111111', rationale: ' =HYPERLINK("bad")', classification: 'Personal', recognized_pence: 0 });
    const bundle = buildFilingPack(input, reviewFixture(input), 'request<script>', false);
    assert.ok(!bundle.artifacts[0].body.includes('<script>'));
    assert.ok(bundle.artifacts[0].body.includes('&lt;script&gt;'));
    const csv = bundle.artifacts.find(a => a.name === 'expense-decisions.csv')!.body;
    assert.ok(csv.includes("' =HYPERLINK"));
    assert.ok(csv.includes('11111111-1111-4111-8111-111111111111'));
    (input.documents as Record<string, unknown>[]).push({ id: 'bad', object_path: 'PRIVATE' });
    assert.throws(() => buildFilingPack(input, [], 'request', false), /Private evidence/);
});
test('full form and short eligibility use reviewed annual mappings rather than free-text category guesses', () => {
    const input = packFixture(), reviews = reviewFixture(input);
    acknowledge(input, 'profile', reviews, { trade_form: 'full', short_eligibility: 'requires_full' });
    assert.ok(buildFilingReview(input, reviews).issues.some(i => i.code === 'full_expense_mapping'));
    acknowledge(input, 'expenses', reviews, { category_boxes: { cat: '20' }, capital_boxes: {} });
    assert.ok(!buildFilingReview(input, reviews).issues.some(i => i.code === 'full_expense_mapping'));
    const lines = buildFilingReview(input, reviews).worksheet;
    assert.equal(lines.find(l => l.id === 'trade-turnover')!.box, '15');
    assert.equal(lines.find(l => l.id === 'taxable-profit')!.box, '76');
    assert.equal(lines.find(l => l.id === 'trade-expenses')!.box, '31');
    assert.throws(() => validateStepData(input, 'expenses', { category_boxes: { foreign: '20' }, capital_boxes: {} }), /owned category/);
});
test('full-form categories aggregate before rounding and losses use positive loss boxes', () => {
    const input = {...accountingTaxPackFixture(), schema_version: 'filing-pack-input/6' as const, documents: []};
    input.calculation.input.records.push({ ...input.calculation.input.records[1], id: 'other-expense', amount_pence: 101, category: { ...input.calculation.input.records[1].category!, id: 'cat2' } });
    const refresh = () => { const p = prepareCalculation(input.calculation.input); Object.assign(input.calculation, { input_canonical_json: p.inputJson, input_sha256: p.inputHash, result: p.result, result_canonical_json: p.resultJson, result_sha256: p.resultHash }); };
    refresh();
    const reviews = reviewFixture(input);
    acknowledge(input, 'profile', reviews, { trade_form: 'full', short_eligibility: 'requires_full' });
    acknowledge(input, 'expenses', reviews, { category_boxes: { cat: '20', cat2: '20' }, capital_boxes: {} });
    const lines = buildFilingReview(input, reviews).worksheet, box = lines.filter(l => l.form === 'SA103F' && l.box === '20');
    assert.equal(box.length, 1);
    assert.equal(box[0].pence, 19010);
    assert.equal(box[0].paper_pounds, 191);
    assert.deepEqual(box[0].source_ids, ['expense', 'other-expense']);
    input.calculation.input.records[0].amount_pence = 100;
    refresh();
    acknowledge(input, 'profile', reviews, { trade_form: 'full', short_eligibility: 'requires_full' });
    const loss = buildFilingReview(input, reviews).worksheet.find(l => l.id === 'trade-profit')!;
    assert.equal(loss.box, '48');
    assert.equal(loss.pence, 18910);
    assert.equal(loss.paper_pounds, null);
    const review = buildFilingReview(input, reviews);
    for (const [id, expectedBox] of [['net-tax-profit', '65'], ['adjusted-profit', '77']]) {
        const line = review.worksheet.find(l => l.id === id)!;
        assert.equal(line.box, expectedBox);
        assert.equal(line.pence, 18910);
        assert.equal(line.paper_pounds, null);
        assert.match(line.label, /loss/i);
    }
    assert.equal(review.canAttest, false);
    assert.equal(review.worksheet.find(l => l.id === 'taxable-profit')!.pence, null);
});
test('short-form tax loss uses box 32 without making a loss relief election', () => {
    const input = {...accountingTaxPackFixture(), schema_version: 'filing-pack-input/6' as const, documents: []};
    input.calculation.input.records[0].amount_pence = 100;
    const p = prepareCalculation(input.calculation.input);
    Object.assign(input.calculation, { input_canonical_json: p.inputJson, input_sha256: p.inputHash, result: p.result, result_canonical_json: p.resultJson, result_sha256: p.resultHash });
    const reviews = reviewFixture(input), review = buildFilingReview(input, reviews);
    const line = review.worksheet.find(l => l.id === 'short-tax-profit')!;
    assert.equal(line.box, '32');assert.equal(line.pence, 18809);assert.equal(line.paper_pounds, null);
    assert.equal(review.canAttest, false);
    assert.throws(() => buildFilingPack(input, reviews, 'loss-request', true), /completeness/);
    assert.equal(buildFilingPack(input, reviews, 'loss-request', false).mapping_version, 'uk-draft-forms-2025-26/3');
});
test('trading allowance leaves expense boxes blank while retained ledgers preserve actual costs', () => {
    for (const form of ['short', 'full']) {
        const input = {...accountingTaxPackFixture(), schema_version: 'filing-pack-input/6' as const, documents: []};
        const c = input.calculation.input;
        c.facts.push({id:'allowance',family_id:'allowance-family',ordinal:1,kind:'trade_adjustment',label:'Synthetic election',tax_year_start:2025,state:'verified',data:{adjustment_type:'trading_allowance',amount_pence:100000,treatment:'evidence_reviewed'},rationale:'Synthetic',created_at:'2026-10-18'});
        c.sources.push({id:'allowance-source',revision_id:'allowance',document_id:'election-document',record_id:null,transaction_id:null,snapshot:{id:'election-document',file_sha256:'a'.repeat(64)},current_recognized_pence:0,source_unresolved:false});
        c.sections.find(s=>s.kind==='trade_adjustment')!.verdict='complete';
        const p = prepareCalculation(c);
        Object.assign(input.calculation, { input_canonical_json: p.inputJson, input_sha256: p.inputHash, result: p.result, result_canonical_json: p.resultJson, result_sha256: p.resultHash });
        const reviews=reviewFixture(input);
        acknowledge(input,'profile',reviews,{trade_form:form,short_eligibility:form==='short'?'full_year_simple':'requires_full'});
        const review=buildFilingReview(input,reviews);
        assert.equal(review.worksheet.some(l=>l.id==='trade-expenses'),false);
        assert.equal(review.worksheet.some(l=>l.id==='capital-total'),false);
        assert.equal(review.worksheet.find(l=>l.id==='trading-allowance')!.pence,100000);
        assert.equal(review.worksheet.find(l=>l.id==='taxable-profit')!.pence,102500);
        assert.equal(input.calculation.result.totals.ledger_expenses,18909);
        const bundle=buildFilingPack(input,reviews,'allowance-'+form,false);
        assert.match(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body,/18909/);
    }
});
test('saved packs reject duplicate artifacts, wrong request or annual mapping even with recalculated outer hashes', () => {
    const input = packFixture(), bundle = buildFilingPack(input, reviewFixture(input), 'request', true), row: SavedFilingPack = { id: 'pack', tax_year_start: 2025, input, input_canonical_json: canonicalJson(input), input_sha256: bundle.input_sha256, bundle, bundle_canonical_json: canonicalJson(bundle), bundle_sha256: sha256(canonicalJson(bundle)), reason: 'Synthetic', author: 'owner', created_at: '2026-10-17', request_id: 'request' };
    const altered = (change: (copy: SavedFilingPack) => void) => { const copy = structuredClone(row); change(copy); copy.bundle_canonical_json = canonicalJson(copy.bundle); copy.bundle_sha256 = sha256(copy.bundle_canonical_json); return copy; };
    assert.throws(() => verifyFilingPack(altered(r => { r.bundle.artifacts[1] = r.bundle.artifacts[0]; })), /integrity/);
    assert.throws(() => verifyFilingPack(altered(r => { r.bundle.request_id = 'other'; })), /integrity/);
    assert.throws(() => verifyFilingPack(altered(r => { r.bundle.mapping_sha256 = '0'.repeat(64); })), /integrity/);
    assert.throws(() => verifyFilingPack(altered(r => { r.bundle.completeness_attested = false; })), /integrity/);
    assert.throws(() => verifyFilingPack(altered(r => { r.bundle.artifacts[0].body += 'changed'; })), /integrity/);
});
