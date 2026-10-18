import { FX_CURRENCY_RULESET, rateFromDecimal } from './currency';
import type { FxSettlementCatalog, FxSettlementIntent } from './settlement';
export const fxFixtureId = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
export function fxSettlementFixture() {
    const id = fxFixtureId, owner = id(1), rate = rateFromDecimal('USD', 'GBP', '0.79');
    const catalog: FxSettlementCatalog = {
        owner_id: owner, ruleset_id: FX_CURRENCY_RULESET, financial_stamp: 'a'.repeat(32), valuations: [], conversion_lots: [{ id: id(70), user_id: owner, invoice_id: id(10), invoice_revision_id: id(11), receipt_id: id(20), evidence_id: id(40), evidence_revision_id: id(42), version: 0, rate, conversion_date: '2026-04-06', prior_invoice_minor: 0, prior_cash_minor: 0, status: 'active', binding_state: 'persisted' }],
        invoices: [{ id: id(10), user_id: owner, revision_id: id(11), invoice_date: '2026-04-05', currency: 'USD', status: 'finalised', invoice_minor: 100000, credited_minor: 0, allocated_minor: 0, returned_minor: 0 }],
        receipts: [{ id: id(20), user_id: owner, import_id: id(21), source_row_id: id(22), transaction_date: '2026-04-06', currency: 'GBP', signed_minor: 79000, allocated_minor: 0, decision_version: 1, import_status: 'review', dedupe_status: 'clear', classification: 'Business', business_use_bps: 10000, active_transfer_id: null, active_refund_id: null, recognized_record_id: id(23), record_transaction_id: id(20), record_type: 'income', record_status: 'approved', effect_sign: 1, recognized_gbp_pence: 79000, valuation_id: null, value_date: '2026-04-06' }],
        evidence: [
            { id: id(30), user_id: owner, document_id: id(31), document_sha256: 'b'.repeat(64), revision_id: id(32), status: 'verified', purpose: 'invoice', invoice_id: id(10), invoice_revision_id: id(11), receipt_id: null, evidence_date: '2026-04-05', conversion_date: null, rate: null, invoice_portion_minor: null, cash_portion_minor: null },
            { id: id(40), user_id: owner, document_id: id(41), document_sha256: 'c'.repeat(64), revision_id: id(42), status: 'verified', purpose: 'conversion', invoice_id: id(10), invoice_revision_id: id(11), receipt_id: id(20), evidence_date: '2026-04-07', conversion_date: '2026-04-06', rate, invoice_portion_minor: 100000, cash_portion_minor: 79000 },
        ],
    };
    const intent: FxSettlementIntent = { schema_version: 'fx-settlement-intent/1', ruleset_id: FX_CURRENCY_RULESET, receipt_id: id(20), receipt_version: 1, expected_stamp: catalog.financial_stamp, rationale: 'Synthetic reviewed conversion evidence', request_id: id(50), fee_mode: 'none', receipt_valuation_id: null, receipt_valuation_evidence_revision_id: null, allocations: [{ invoice_id: id(10), invoice_revision_id: id(11), invoice_minor: 100000, cash_minor: 79000, conversion_date: '2026-04-06', rate, invoice_evidence_id: id(30), invoice_evidence_revision_id: id(32), conversion_evidence_id: id(40), conversion_evidence_revision_id: id(42), conversion_lot_id: id(70), conversion_lot_version: 0 }] };
    return { owner, catalog, intent };
}
