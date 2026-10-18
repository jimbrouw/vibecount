import assert from 'node:assert/strict';
import test from 'node:test';
import { fxFixtureId as id, fxSettlementFixture } from './fixture';
import { fxSettlementReview, validateFxSettlementIntent } from './settlement';
import { rateFromDecimal } from './currency';

test('foreign invoice consumes its own units and actual bank cash independently without new income', () => {
    const f = fxSettlementFixture(), before = JSON.stringify(f), { result } = fxSettlementReview(f.owner, f.intent, f.catalog);
    assert.equal(result.rows[0].invoice_minor, 100000); assert.equal(result.rows[0].invoice_currency, 'USD');
    assert.equal(result.observed_cash_minor, 79000); assert.equal(result.cash_currency, 'GBP'); assert.equal(result.unallocated_cash_minor, 0);
    assert.equal(result.receipt_recognized_gbp_pence, 79000); assert.equal(result.recognized_income_change_pence, 0); assert.equal(result.recognized_expense_change_pence, 0);
    assert.equal(result.rows[0].invoice_outstanding_after_minor, 0); assert.equal(result.financial_action, 'preview_only');
    assert.equal(result.rows[0].invoice_date, '2026-04-05'); assert.equal(result.cash_date, '2026-04-06'); assert.equal(result.rows[0].conversion_evidence.evidence_date, '2026-04-07');
    assert.equal(result.rows[0].conversion_date, '2026-04-06'); assert.equal(JSON.stringify(f), before);
});
test('partial and credited invoice capacities remain independent from the receipt capacity', () => {
    const f = fxSettlementFixture(); f.intent.allocations[0].invoice_minor = 50000; f.intent.allocations[0].cash_minor = 39500;
    const partial = fxSettlementReview(f.owner, f.intent, f.catalog).result;
    assert.equal(partial.unallocated_cash_minor, 39500); assert.equal(partial.rows[0].invoice_outstanding_after_minor, 50000);
    f.catalog.receipts[0].allocated_minor = 40000; assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /independently available/);
    f.catalog.receipts[0].allocated_minor = 0; f.catalog.invoices[0].credited_minor = 60000;
    assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /original-currency/);
    f.catalog.invoices[0].credited_minor = 50000; f.catalog.invoices[0].allocated_minor = 60000; f.catalog.invoices[0].returned_minor = 20000;
    f.intent.allocations[0].invoice_minor = 10000; f.intent.allocations[0].cash_minor = 7900;
    assert.equal(fxSettlementReview(f.owner, f.intent, f.catalog).result.rows[0].invoice_outstanding_after_minor, 0);
});
test('rate/date/evidence/source ownership and provenance are authoritative; fee guesses reject', () => {
    const f = fxSettlementFixture();
    for (const patch of [{ owner_id: id(99) }, { financial_stamp: 'b'.repeat(32) }, { ruleset_id: 'future' }]) assert.throws(() => fxSettlementReview(f.owner, f.intent, { ...f.catalog, ...patch }));
    for (const patch of [{ user_id: id(99) }, { decision_version: 2 }, { currency: 'JPY' }, { recognized_gbp_pence: 1 }, { recognized_record_id: '' }, { record_transaction_id: id(99) }, { record_type: 'expense' }, { record_status: 'excluded' }, { effect_sign: -1 }, { dedupe_status: 'needs_review' }, { active_refund_id: id(99) }, { active_transfer_id: id(99) }, { import_status: 'discarded' }, { classification: 'Personal' }, { business_use_bps: 5000 }, { transaction_date: '2026-02-30' }]) {
        const c = structuredClone(f.catalog); Object.assign(c.receipts[0], patch); assert.throws(() => fxSettlementReview(f.owner, f.intent, c), JSON.stringify(patch));
    }
    for (const patch of [{ user_id: id(99) }, { status: 'provisional' }, { invoice_id: id(99) }, { invoice_revision_id: id(99) }, { receipt_id: id(99) }, { document_sha256: '' }, { document_sha256: 'c'.repeat(64) + '\n' }, { document_id: '' }, { revision_id: '' }, { conversion_date: '2026-04-05' }, { rate: rateFromDecimal('USD', 'GBP', '0.8') }]) {
        const c = structuredClone(f.catalog); Object.assign(c.evidence[1], patch); assert.throws(() => fxSettlementReview(f.owner, f.intent, c), JSON.stringify(patch));
    }
    for (const patch of [{ invoice_minor: 1 }, { cash_minor: 78999 }, { conversion_date: '2026-04-05' }, { rate: rateFromDecimal('GBP', 'USD', '0.79') }]) {
        const intent = structuredClone(f.intent); Object.assign(intent.allocations[0], patch); assert.throws(() => fxSettlementReview(f.owner, intent, f.catalog));
    }
    assert.throws(() => fxSettlementReview(f.owner, { ...f.intent, fee_mode: 'withheld' }, f.catalog));
    assert.throws(() => fxSettlementReview(f.owner, { ...f.intent, fee_mode: 'separate' }, f.catalog));
    const intent = structuredClone(f.intent); intent.allocations[0].rate = rateFromDecimal('USD', 'GBP', '0.8');
    assert.throws(() => fxSettlementReview(f.owner, intent, f.catalog), /evidence/);
});
test('foreign cash requires the exact current source valuation and its independent evidence', () => {
    const f = fxSettlementFixture(), r = f.catalog.receipts[0], rate = rateFromDecimal('EUR', 'GBP', '0.8'), paymentRate = rateFromDecimal('USD', 'EUR', '0.9');
    Object.assign(r, { currency: 'EUR', signed_minor: 90000, recognized_gbp_pence: 72000, valuation_id: id(60) });
    f.intent.allocations[0].cash_minor = 90000; f.intent.allocations[0].rate = paymentRate; f.catalog.evidence[1].rate = paymentRate; f.catalog.evidence[1].cash_portion_minor = 90000; f.catalog.conversion_lots[0].rate = paymentRate; f.intent.receipt_valuation_id = id(60); f.intent.receipt_valuation_evidence_revision_id = id(42);
    f.catalog.valuations.push({ id: id(60), user_id: f.owner, transaction_id: r.id, receipt_version: 1, source_minor: 90000, currency: 'EUR', gbp_pence: 72000, rate, value_date: '2026-04-06', record_id: r.recognized_record_id, evidence_id: id(61), status: 'approved' });
    f.catalog.evidence.push({ ...f.catalog.evidence[1], id: id(61), purpose: 'valuation', invoice_id: null, invoice_revision_id: null, rate });
    const review = fxSettlementReview(f.owner, f.intent, f.catalog).result;
    assert.equal(review.observed_cash_minor, 90000); assert.equal(review.cash_currency, 'EUR'); assert.equal(review.receipt_recognized_gbp_pence, 72000); assert.equal(review.recognized_income_change_pence, 0);
    assert.equal(review.receipt_valuation!.conversion.target_minor, 72000);
    const changedEvidence = structuredClone(f.catalog); changedEvidence.evidence[2].revision_id = id(99); assert.throws(() => fxSettlementReview(f.owner, f.intent, changedEvidence), /valuation/);
    for (const patch of [{ user_id: id(99) }, { transaction_id: id(99) }, { receipt_version: 2 }, { source_minor: 1 }, { gbp_pence: 1 }, { record_id: id(99) }, { evidence_id: id(99) }, { status: 'reversed' }, { rate: rateFromDecimal('EUR', 'GBP', '0.9') }]) {
        const c = structuredClone(f.catalog); Object.assign(c.valuations[0], patch); assert.throws(() => fxSettlementReview(f.owner, f.intent, c));
    }
});
test('strict intent and detached safe output reject private payloads and retain no mutable references', () => {
    const f = fxSettlementFixture();
    for (const patch of [{ raw_bank_pdf: 'PRIVATE' }, { receipt_version: null }, { receipt_version: 2147483647 }, { receipt_id: '' }, { expected_stamp: '' }, { allocations: [] }, { rationale: '' }]) assert.throws(() => validateFxSettlementIntent({ ...f.intent, ...patch }));
    const intent = structuredClone(f.intent); Object.assign(intent.allocations[0], { storage_path: 'PRIVATE' }); assert.throws(() => validateFxSettlementIntent(intent));
    assert.throws(() => validateFxSettlementIntent({ ...f.intent, allocations: [f.intent.allocations[0], f.intent.allocations[0]] }));
    Object.assign(f.catalog.receipts[0], { bank_details: 'PRIVATE', raw_cells: ['PRIVATE'] }); Object.assign(f.catalog.evidence[0], { storage_path: 'PRIVATE', filename: 'PRIVATE' });
    f.intent.rationale = 'Review bank account 12345678'; const result = fxSettlementReview(f.owner, f.intent, f.catalog), old = JSON.stringify(result);
    assert.ok(!old.includes('PRIVATE')); assert.ok(!old.includes('12345678'));
    f.catalog.evidence[1].rate!.numerator = '1'; f.catalog.invoices[0].invoice_minor = 1; f.intent.allocations[0].cash_minor = 1;
    assert.equal(JSON.stringify(result), old);
});

test('current capacity uses retained units after returned cash and reallocation', () => {
    const f = fxSettlementFixture(); Object.assign(f.catalog.invoices[0], { allocated_minor: 150000, returned_minor: 100000 });
    f.intent.allocations[0].invoice_minor = 50000; f.intent.allocations[0].cash_minor = 39500;
    const r = fxSettlementReview(f.owner, f.intent, f.catalog).result;
    assert.equal(r.rows[0].invoice_outstanding_before_minor, 50000); assert.equal(r.rows[0].invoice_outstanding_after_minor, 0);
    f.catalog.invoices[0].returned_minor = 150001; assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /inconsistent/);
});
test('exact evidence revisions and conversion lot history are bound before preview', () => {
    const f = fxSettlementFixture();
    for (const index of [0, 1]) { const c = structuredClone(f.catalog); c.evidence[index].revision_id = id(99); assert.throws(() => fxSettlementReview(f.owner, f.intent, c), /evidence/); }
    for (const patch of [{ user_id: id(99) }, { invoice_id: id(99) }, { invoice_revision_id: id(99) }, { receipt_id: id(99) }, { evidence_revision_id: id(99) }, { version: 1 }, { status: 'reversed' }, { conversion_date: '2026-04-05' }, { prior_invoice_minor: 1 }, { prior_cash_minor: 1 }]) {
        const c = structuredClone(f.catalog); Object.assign(c.conversion_lots[0], patch); assert.throws(() => fxSettlementReview(f.owner, f.intent, c), JSON.stringify(patch));
    }
    for (const patch of [{ receipt_id: f.intent.receipt_id + '\n' }, { expected_stamp: f.intent.expected_stamp + '\n' }]) assert.throws(() => validateFxSettlementIntent({ ...f.intent, ...patch }));
});
test('partial settlements of one conversion lot retain a final zero-cash portion', () => {
    const f = fxSettlementFixture(), rate = rateFromDecimal('USD', 'GBP', '0.5');
    Object.assign(f.catalog.invoices[0], { invoice_minor: 2 }); Object.assign(f.catalog.receipts[0], { signed_minor: 1, recognized_gbp_pence: 1 });
    Object.assign(f.intent.allocations[0], { invoice_minor: 1, cash_minor: 1, rate }); Object.assign(f.catalog.evidence[1], { rate, invoice_portion_minor: 2, cash_portion_minor: 1 }); f.catalog.conversion_lots[0].rate = rate;
    assert.equal(fxSettlementReview(f.owner, f.intent, f.catalog).result.allocated_cash_minor, 1);
    f.catalog.invoices[0].allocated_minor = 1; f.catalog.receipts[0].allocated_minor = 1;
    Object.assign(f.catalog.conversion_lots[0], { prior_invoice_minor: 1, prior_cash_minor: 1, version: 1 });
    f.intent.allocations[0].conversion_lot_version = 1; f.intent.allocations[0].cash_minor = 0;
    const result = fxSettlementReview(f.owner, f.intent, f.catalog).result;
    assert.equal(result.allocated_cash_minor, 0); assert.equal(result.unallocated_cash_minor, 0); assert.equal(result.rows[0].invoice_outstanding_after_minor, 0);
    assert.equal(result.rows[0].tranche.before.target_minor, 1); assert.equal(result.rows[0].tranche.after.target_minor, 1); assert.equal(result.recognized_income_change_pence, 0);
    f.catalog.conversion_lots[0].prior_cash_minor = 0; assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /inconsistent/);
});
test('one receipt can discharge different invoice currencies without adding unlike invoice units', () => {
    const f = fxSettlementFixture(), rate = rateFromDecimal('EUR', 'GBP', '0.8');
    Object.assign(f.catalog.receipts[0], { signed_minor: 87000, recognized_gbp_pence: 87000 });
    f.catalog.invoices.push({ ...f.catalog.invoices[0], id: id(100), revision_id: id(101), currency: 'EUR', invoice_minor: 10000 });
    f.catalog.evidence.push({ ...f.catalog.evidence[0], id: id(110), revision_id: id(111), invoice_id: id(100), invoice_revision_id: id(101) });
    f.catalog.evidence.push({ ...f.catalog.evidence[1], id: id(120), revision_id: id(121), invoice_id: id(100), invoice_revision_id: id(101), rate, invoice_portion_minor: 10000, cash_portion_minor: 8000 });
    f.catalog.conversion_lots.push({ ...f.catalog.conversion_lots[0], id: id(130), invoice_id: id(100), invoice_revision_id: id(101), evidence_id: id(120), evidence_revision_id: id(121), rate });
    f.intent.allocations.push({ ...f.intent.allocations[0], invoice_id: id(100), invoice_revision_id: id(101), invoice_minor: 10000, cash_minor: 8000, rate, invoice_evidence_id: id(110), invoice_evidence_revision_id: id(111), conversion_evidence_id: id(120), conversion_evidence_revision_id: id(121), conversion_lot_id: id(130) });
    const a = fxSettlementReview(f.owner, f.intent, f.catalog);
    const b = fxSettlementReview(f.owner, { ...f.intent, allocations: [...f.intent.allocations].reverse() }, { ...f.catalog, invoices: [...f.catalog.invoices].reverse(), evidence: [...f.catalog.evidence].reverse() });
    assert.deepEqual(a, b); assert.equal(a.result.allocated_cash_minor, 87000); assert.equal(a.result.unallocated_cash_minor, 0);
    assert.deepEqual(a.result.rows.map(r => [r.invoice_currency, r.invoice_minor, r.cash_minor]), [['USD', 100000, 79000], ['EUR', 10000, 8000]]);
    assert.equal(a.result.recognized_income_change_pence, 0);
    // Each lot looks individually plausible, but both cannot own the same prior cash.
    Object.assign(f.catalog.receipts[0], { signed_minor: 100000, recognized_gbp_pence: 100000, allocated_minor: 7900 });
    Object.assign(f.catalog.conversion_lots[0], { prior_invoice_minor: 10000, prior_cash_minor: 7900 });
    Object.assign(f.catalog.conversion_lots[1], { prior_invoice_minor: 9875, prior_cash_minor: 7900 });
    f.catalog.invoices[0].allocated_minor = 10000; f.catalog.invoices[1].allocated_minor = 9875;
    f.intent.allocations[0].invoice_minor = 100; f.intent.allocations[0].cash_minor = 79;
    f.intent.allocations[1].invoice_minor = 100; f.intent.allocations[1].cash_minor = 80;
    assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /lot totals/);
});

test('documented conversion portions bound the whole cumulative lot independently of invoice and cash capacity', () => {
    const f = fxSettlementFixture();
    const small = structuredClone(f.intent); small.allocations[0].invoice_minor = 100; small.allocations[0].cash_minor = 79;
    const oversized = structuredClone(f.catalog); Object.assign(oversized.evidence[1], { invoice_portion_minor: 200000, cash_portion_minor: 158000 });
    assert.throws(() => fxSettlementReview(f.owner, small, oversized), /documented/);
    const smallerReceipt = structuredClone(f.catalog); Object.assign(smallerReceipt.receipts[0], { signed_minor: 1000, recognized_gbp_pence: 1000 });
    assert.throws(() => fxSettlementReview(f.owner, small, smallerReceipt), /documented/);
    f.catalog.evidence[1].invoice_portion_minor = 50000; f.catalog.evidence[1].cash_portion_minor = 39500;
    assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /documented/);
    f.intent.allocations[0].invoice_minor = 50000; f.intent.allocations[0].cash_minor = 39500;
    assert.equal(fxSettlementReview(f.owner, f.intent, f.catalog).result.allocated_cash_minor, 39500);
    Object.assign(f.catalog.conversion_lots[0], { prior_invoice_minor: 40000, prior_cash_minor: 31600, version: 1 });
    f.catalog.invoices[0].allocated_minor = 40000; f.catalog.receipts[0].allocated_minor = 31600; f.intent.allocations[0].conversion_lot_version = 1;
    f.intent.allocations[0].invoice_minor = 20000; f.intent.allocations[0].cash_minor = 15800;
    assert.throws(() => fxSettlementReview(f.owner, f.intent, f.catalog), /documented/);
    for (const patch of [{ invoice_portion_minor: null }, { invoice_portion_minor: 0 }, { cash_portion_minor: null }, { cash_portion_minor: -1 }, { cash_portion_minor: 39501 }]) {
        const c = structuredClone(f.catalog); Object.assign(c.evidence[1], patch); assert.throws(() => fxSettlementReview(f.owner, f.intent, c));
    }
});
