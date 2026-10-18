import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeInvoiceMatches, receiptQueue, type MatchReceipt, type MatchInvoice } from './match-proposals.ts';
const receipt = (pence = 150000): MatchReceipt => ({ id: 'receipt', import_id: 'import', transaction_date: '2025-08-10', description: 'Nottingham Contemporary freelance work', reference: 'INV-1500', signed_amount_pence: pence, allocated_pence: 0, unallocated_pence: pence, decision_version: 1, classification: 'Business', business_use_bps: 10000, dedupe_status: 'clear', record_status: 'approved', record_type: 'income', recognized_pence: pence, currency: 'GBP', active_transfer_id: null, active_refund_id: null });
const invoice = (id = 'invoice', pence = 150000): MatchInvoice => ({ id, number: 'INV-1500', invoice_date: '2025-08-01', client_id: 'client', client_name: 'Nottingham Contemporary', invoice_pence: pence, allocated_pence: 0, outstanding_pence: pence, updated_at: 'version1', currency: 'GBP', status: 'finalised' });
test('explained matches use reference, payer, amount and date without classifying or posting income', () => {
    for (const pence of [25000, 27500, 150000]) {
        const r = receipt(pence), i = invoice('invoice', pence), before = JSON.stringify([r, i]), p = proposeInvoiceMatches(r, [i])[0];
        assert.equal(p.strength, 'strong');
        assert.equal(p.amount_pence, pence);
        assert.equal(p.invoice_updated_at, 'version1');
        assert.equal(p.reasons.length, 4);
        assert.equal(JSON.stringify([r, i]), before);
    }
    const r = receipt();
    r.reference = '';
    const same = proposeInvoiceMatches(r, [invoice()])[0];
    assert.equal(same.strength, 'strong');
    r.description = 'Unknown payer';
    const weak = proposeInvoiceMatches(r, [invoice()])[0];
    assert.equal(weak.strength, 'review');
    assert.ok(weak.warnings.some(w => w.includes('amounts alone')));
});
test('bounded references and common names never manufacture identity; equal evidence remains ambiguous', () => {
    const r = receipt();
    r.description = 'Studio';
    r.reference = 'INV-10';
    const i = invoice();
    i.number = 'INV-1';
    i.client_name = 'The Studio';
    i.outstanding_pence = 99900;
    assert.equal(proposeInvoiceMatches(r, [i]).length, 0);
    r.reference = '1';
    i.number = '1';
    assert.equal(proposeInvoiceMatches(r, [i]).length, 0);
    r.reference = 'INV-1500';
    const matches = proposeInvoiceMatches(r, [invoice('b'), invoice('a')]);
    assert.deepEqual(matches.map(p => p.invoice_id), ['a', 'b']);
    assert.ok(matches.every(p => p.ambiguous && p.strength === 'review'));
});
test('partial/current capacity and cross-year payments remain separate from invoice gross', () => {
    const r = receipt(50000), i = invoice();
    i.invoice_date = '2025-04-05';
    r.transaction_date = '2025-04-06';
    i.invoice_pence = 200000;
    i.allocated_pence = 50000;
    i.outstanding_pence = 90000;
    const p = proposeInvoiceMatches(r, [i])[0];
    assert.equal(p.amount_pence, 50000);
    assert.ok(p.reasons.some(r => r.includes('partially')));
    r.unallocated_pence = 100000;
    assert.equal(proposeInvoiceMatches(r, [i])[0].amount_pence, 90000);
    r.transaction_date = '2025-04-04';
    assert.equal(proposeInvoiceMatches(r, [i])[0].strength, 'review');
    assert.ok(proposeInvoiceMatches(r, [i])[0].warnings.some(w => w.includes('predates')));
});
test('ineligible cash never receives an executable suggestion; unmatched cash sorts independently of matching strength', () => {
    for (const change of [{ classification: 'Unknown' }, { classification: 'Personal' }, { record_type: 'expense' }, { record_status: 'draft' }, { dedupe_status: 'possible_duplicate' }, { active_transfer_id: 'transfer' }, { active_refund_id: 'refund' }, { currency: 'USD' }, { business_use_bps: 3000 }, { recognized_pence: 149999 }])
        assert.equal(proposeInvoiceMatches({ ...receipt(), ...change }, [invoice()]).length, 0);
    for (const change of [{ status: 'draft' }, { currency: 'EUR' }, { outstanding_pence: 0 }])
        assert.equal(proposeInvoiceMatches(receipt(), [{ ...invoice(), ...change }]).length, 0);
    const large = { ...receipt(150000), id: 'large', description: 'Unfamiliar employer-like name', classification: 'Unknown' }, small = { ...receipt(25000), id: 'small' }, excluded = { ...receipt(999999), id: 'personal', classification: 'Personal' };
    const queue = receiptQueue([small, excluded, large]);
    assert.deepEqual(queue.map(q => q.receipt.id), ['large', 'small']);
    assert.equal(queue[0].kind, 'classification');
    assert.equal(proposeInvoiceMatches(large, [invoice()]).length, 0);
});
test('a known conflicting or multi-invoice reference prevents an identity shortcut', () => {
    const r = receipt(), a = invoice('a'), b = { ...invoice('b'), number: 'INV-9999' };
    const matches = proposeInvoiceMatches(r, [a, b]);
    assert.equal(matches.find(p => p.invoice_id === 'a')!.strength, 'strong');
    assert.equal(matches.find(p => p.invoice_id === 'b')!.strength, 'review');
    assert.ok(matches.find(p => p.invoice_id === 'b')!.warnings.some(w => w.includes('another known')));
    r.reference = 'INV-1500 and INV-9999';
    assert.ok(proposeInvoiceMatches(r, [a, b]).every(p => p.strength === 'review' && p.warnings.some(w => w.includes('multiple invoices'))));
});
test('reviewed duplicate exclusions remain history instead of re-entering the exception queue', () => {
    const duplicate = { ...receipt(), id: 'duplicate', dedupe_status: 'duplicate', classification: 'Unknown', record_status: 'excluded' };
    assert.equal(receiptQueue([duplicate]).length, 0);
    assert.equal(proposeInvoiceMatches(duplicate, [invoice()]).length, 0);
});
test('unpaired transfer/refund tags stay visible for relationship review while completed pairs stay in history', () => {
    const transfer = { ...receipt(), id: 'transfer', classification: 'Transfer' }, refund = { ...receipt(), id: 'refund', classification: 'Refund' }, paired = { ...transfer, id: 'paired', active_transfer_id: 'pair' }, linked = { ...refund, id: 'linked', active_refund_id: 'link' };
    const queue = receiptQueue([transfer, refund, paired, linked]);
    assert.equal(queue.length, 2);
    assert.equal(queue.find(q => q.receipt.id === 'transfer')!.kind, 'transfer');
    assert.equal(queue.find(q => q.receipt.id === 'refund')!.kind, 'refund');
    assert.equal(proposeInvoiceMatches(transfer, [invoice()]).length, 0);
    assert.equal(proposeInvoiceMatches(refund, [invoice()]).length, 0);
});
