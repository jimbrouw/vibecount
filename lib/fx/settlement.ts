import { redactBankDetailsForPrompt } from '../ai/redaction';
import { convertCurrencyMinor, convertCurrencyTranche, currencyCode, currencyMinor, exactObject, FX_CURRENCY_RULESET, fxRate, type CurrencyCode, type FxRate } from './currency';

export type FxInvoice = {
    id: string; user_id: string; revision_id: string; invoice_date: string; currency: CurrencyCode; status: string;
    invoice_minor: number; credited_minor: number; allocated_minor: number; returned_minor: number;
};
export type FxReceipt = {
    id: string; user_id: string; import_id: string; source_row_id: string; transaction_date: string; currency: CurrencyCode;
    signed_minor: number; allocated_minor: number; decision_version: number; import_status: string; dedupe_status: string;
    classification: string; business_use_bps: number; active_transfer_id: string | null; active_refund_id: string | null;
    recognized_record_id: string; record_transaction_id: string; record_type: string; record_status: string; effect_sign: number;
    recognized_gbp_pence: number; valuation_id: string | null; value_date: string;
};
export type FxEvidence = {
    id: string; user_id: string; document_id: string; document_sha256: string; revision_id: string; status: string;
    purpose: 'invoice' | 'conversion' | 'valuation'; invoice_id: string | null; invoice_revision_id: string | null; receipt_id: string | null; evidence_date: string; conversion_date: string | null; rate: FxRate | null;
    invoice_portion_minor: number | null; cash_portion_minor: number | null;
};
export type FxValuation = {
    id: string; user_id: string; transaction_id: string; receipt_version: number; source_minor: number; currency: CurrencyCode;
    gbp_pence: number; rate: FxRate; value_date: string; record_id: string; evidence_id: string; status: string;
};
export type FxConversionLot = {
    id: string; user_id: string; invoice_id: string; invoice_revision_id: string; receipt_id: string;
    evidence_id: string; evidence_revision_id: string; version: number; rate: FxRate; conversion_date: string;
    prior_invoice_minor: number; prior_cash_minor: number; status: string; binding_state: 'persisted' | 'proposed';
};
export type FxSettlementCatalog = {
    owner_id: string; ruleset_id: string; financial_stamp: string;
    invoices: FxInvoice[]; receipts: FxReceipt[]; evidence: FxEvidence[]; valuations: FxValuation[]; conversion_lots: FxConversionLot[];
};
export type FxSettlementIntent = {
    schema_version: 'fx-settlement-intent/1'; ruleset_id: typeof FX_CURRENCY_RULESET; receipt_id: string; receipt_version: number;
    expected_stamp: string; rationale: string; request_id: string; fee_mode: 'none'; receipt_valuation_id: string | null; receipt_valuation_evidence_revision_id: string | null;
    allocations: { invoice_id: string; invoice_revision_id: string; invoice_minor: number; cash_minor: number; conversion_date: string; rate: FxRate;
        invoice_evidence_id: string; invoice_evidence_revision_id: string; conversion_evidence_id: string; conversion_evidence_revision_id: string; conversion_lot_id: string; conversion_lot_version: number }[];
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function identity(value: unknown): string { if (typeof value !== 'string' || value.length !== 36 || !uuid.test(value)) throw new Error('Review an owned FX identity.'); return value.toLowerCase(); }
function version(value: unknown): number { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= 2147483647) throw new Error('Review a current source version.'); return value as number; }
function financialStamp(value: unknown): string { if (typeof value !== 'string' || value.length !== 32 || !/^[a-f0-9]{32}$/.test(value)) throw new Error('Review the exact financial stamp.'); return value; }
function amount(value: unknown, positive = false): number { const n = currencyMinor(value); if (n < (positive ? 1 : 0)) throw new Error('Review positive amounts and nonnegative balances.'); return n; }
function date(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9998-12-31') throw new Error('Review an exact FX date.');
    const n = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('Review a real calendar date.'); return value;
}
export function validateFxSettlementIntent(value: unknown): FxSettlementIntent {
    const p = exactObject(value, ['schema_version', 'ruleset_id', 'receipt_id', 'receipt_version', 'expected_stamp', 'rationale', 'request_id', 'fee_mode', 'receipt_valuation_id', 'receipt_valuation_evidence_revision_id', 'allocations']);
    if (p.schema_version !== 'fx-settlement-intent/1' || p.ruleset_id !== FX_CURRENCY_RULESET || p.fee_mode !== 'none') throw new Error('Use the reviewed FX rules; fee and gross-up treatment needs its own complete review.');
    if (typeof p.rationale !== 'string' || !p.rationale.trim() || p.rationale.trim().length > 1000) throw new Error('Add a bounded FX review reason.');
    const rationale = redactBankDetailsForPrompt(p.rationale.trim()); if (rationale.length > 1000) throw new Error('Shorten the reason without private details.');
    if (!Array.isArray(p.allocations) || p.allocations.length < 1 || p.allocations.length > 50) throw new Error('Review one to 50 independent invoice/cash portions.');
    const allocations = p.allocations.map(value => {
        const a = exactObject(value, ['invoice_id', 'invoice_revision_id', 'invoice_minor', 'cash_minor', 'conversion_date', 'rate', 'invoice_evidence_id', 'invoice_evidence_revision_id', 'conversion_evidence_id', 'conversion_evidence_revision_id', 'conversion_lot_id', 'conversion_lot_version']);
        return { invoice_id: identity(a.invoice_id), invoice_revision_id: identity(a.invoice_revision_id), invoice_minor: amount(a.invoice_minor, true), cash_minor: amount(a.cash_minor), conversion_date: date(a.conversion_date), rate: fxRate(a.rate), invoice_evidence_id: identity(a.invoice_evidence_id), invoice_evidence_revision_id: identity(a.invoice_evidence_revision_id), conversion_evidence_id: identity(a.conversion_evidence_id), conversion_evidence_revision_id: identity(a.conversion_evidence_revision_id), conversion_lot_id: identity(a.conversion_lot_id), conversion_lot_version: version(a.conversion_lot_version) };
    }).sort((a, b) => a.invoice_id < b.invoice_id ? -1 : a.invoice_id > b.invoice_id ? 1 : 0);
    if (new Set(allocations.map(a => a.invoice_id)).size !== allocations.length) throw new Error('An invoice may occur once in this reviewed request.');
    return { schema_version: 'fx-settlement-intent/1', ruleset_id: FX_CURRENCY_RULESET, receipt_id: identity(p.receipt_id), receipt_version: version(p.receipt_version), expected_stamp: financialStamp(p.expected_stamp), rationale, request_id: identity(p.request_id), fee_mode: 'none', receipt_valuation_id: p.receipt_valuation_id === null ? null : identity(p.receipt_valuation_id), receipt_valuation_evidence_revision_id: p.receipt_valuation_evidence_revision_id === null ? null : identity(p.receipt_valuation_evidence_revision_id), allocations };
}
function owned<T extends { id: string; user_id: string }>(rows: T[], owner: string) {
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Complete bounded FX catalog unavailable.');
    const result = new Map<string, T>();
    for (const row of rows) {
        const id = identity(row.id); if (identity(row.user_id) !== owner || result.has(id)) throw new Error('Complete owned unique FX sources required.');
        result.set(id, row);
    }
    return result;
}
/** Pure detached read-back; a future guarded writer must reread authoritative context.
 * Matching never creates recognised income. This does not enable FX application use.
 */
export function fxSettlementReview(ownerValue: string, value: unknown, catalog: FxSettlementCatalog) {
    const owner = identity(ownerValue), intent = validateFxSettlementIntent(value);
    if (identity(catalog.owner_id) !== owner || catalog.ruleset_id !== intent.ruleset_id || catalog.financial_stamp !== intent.expected_stamp) throw new Error('FX source or financial context changed.');
    const invoices = owned(catalog.invoices, owner), receipts = owned(catalog.receipts, owner), evidence = owned(catalog.evidence, owner), valuations = owned(catalog.valuations, owner), lots = owned(catalog.conversion_lots, owner);
    const receipt = receipts.get(intent.receipt_id);
    if (!receipt || receipt.decision_version !== intent.receipt_version) throw new Error('Receipt source version changed.');
    identity(receipt.import_id); identity(receipt.source_row_id); identity(receipt.recognized_record_id); version(receipt.decision_version);
    const cashCurrency = currencyCode(receipt.currency), cashDate = date(receipt.transaction_date), valueDate = date(receipt.value_date);
    const cash = amount(receipt.signed_minor, true), allocated = amount(receipt.allocated_minor), gbpValue = amount(receipt.recognized_gbp_pence, true);
    if (allocated > cash || !['review', 'committed'].includes(receipt.import_status) || receipt.dedupe_status !== 'clear' || receipt.classification !== 'Business' || receipt.business_use_bps !== 10000 || receipt.active_transfer_id || receipt.active_refund_id || receipt.record_transaction_id !== receipt.id || receipt.record_type !== 'income' || receipt.record_status !== 'approved' || receipt.effect_sign !== 1) throw new Error('Review eligible source-linked receipt income and resolve dependencies first.');
    if (cashCurrency === 'GBP') { if (receipt.valuation_id !== null || intent.receipt_valuation_id !== null || intent.receipt_valuation_evidence_revision_id !== null || gbpValue !== cash || valueDate !== cashDate) throw new Error('GBP cash must retain its actual GBP value and cash date.'); }
    let valuation = null;
    if (cashCurrency !== 'GBP') {
        const v = valuations.get(identity(receipt.valuation_id));
        if (intent.receipt_valuation_id !== receipt.valuation_id || !v || v.status !== 'approved' || v.transaction_id !== receipt.id || v.receipt_version !== receipt.decision_version || v.source_minor !== cash || v.currency !== cashCurrency || v.gbp_pence !== gbpValue || v.record_id !== receipt.recognized_record_id || date(v.value_date) !== valueDate) throw new Error('Current owned receipt valuation is incomplete or changed.');
        const conversion = convertCurrencyMinor(cash, v.rate), e = evidence.get(identity(v.evidence_id));
        if (conversion.rate.source_currency !== cashCurrency || conversion.rate.target_currency !== 'GBP' || conversion.target_minor !== gbpValue || !e || e.status !== 'verified' || e.purpose !== 'valuation' || e.receipt_id !== receipt.id || e.invoice_id !== null || e.invoice_revision_id !== null || e.revision_id !== intent.receipt_valuation_evidence_revision_id || e.conversion_date !== valueDate || JSON.stringify(fxRate(e.rate)) !== JSON.stringify(conversion.rate)) throw new Error('Review complete source-linked GBP valuation evidence.');
        identity(e.document_id); identity(e.revision_id); date(e.evidence_date);
        if (typeof e.document_sha256 !== 'string' || e.document_sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(e.document_sha256)) throw new Error('Retained valuation evidence identity unavailable.');
        valuation = { id: v.id, source_minor: cash, gbp_pence: gbpValue, value_date: valueDate, conversion,
            evidence: { id: e.id, revision_id: e.revision_id, document_id: e.document_id, document_sha256: e.document_sha256, evidence_date: e.evidence_date } };
    }
    function proof(id: string, purpose: 'invoice' | 'conversion', invoiceId: string, revisionId: string, expectedEvidenceRevision: string) {
        const e = evidence.get(id);
        if (!e || e.status !== 'verified' || e.revision_id !== expectedEvidenceRevision || e.purpose !== purpose || e.invoice_id === null || identity(e.invoice_id) !== invoiceId || e.invoice_revision_id !== revisionId || (purpose === 'conversion' ? e.receipt_id !== receipt!.id : e.receipt_id !== null || e.rate !== null || e.conversion_date !== null)) throw new Error('Review current owned evidence for this exact invoice and conversion.');
        identity(e.document_id); identity(e.revision_id); date(e.evidence_date);
        if (typeof e.document_sha256 !== 'string' || e.document_sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(e.document_sha256)) throw new Error('Retained source evidence identity unavailable.');
        return { id: identity(e.id), revision_id: identity(e.revision_id), document_id: identity(e.document_id), document_sha256: e.document_sha256, purpose: e.purpose, evidence_date: e.evidence_date };
    }
    let allocatedCash = 0, selectedPriorCash = 0;
    const rows = intent.allocations.map(a => {
        const invoice = invoices.get(a.invoice_id);
        if (!invoice || invoice.status !== 'finalised' || identity(invoice.revision_id) !== a.invoice_revision_id) throw new Error('Review the current finalised invoice revision.');
        const invoiceDate = date(invoice.invoice_date), code = currencyCode(invoice.currency), gross = amount(invoice.invoice_minor, true), credit = amount(invoice.credited_minor), matched = amount(invoice.allocated_minor), returned = amount(invoice.returned_minor);
        if (credit > gross || returned > matched) throw new Error('Invoice balances are inconsistent; load complete history.');
        const entitlement = gross - credit, retained = matched - returned, outstanding = Math.max(entitlement - retained, 0);
        if (a.invoice_minor > outstanding) throw new Error('Invoice portion exceeds its original-currency outstanding capacity.');
        if (a.rate.source_currency !== code || a.rate.target_currency !== cashCurrency) throw new Error('Rate direction must link invoice currency to observed cash currency.');
        const lot = lots.get(a.conversion_lot_id);
        if (!lot || !['persisted', 'proposed'].includes(lot.binding_state) || (lot.binding_state === 'proposed' && (lot.version !== 0 || lot.prior_invoice_minor !== 0 || lot.prior_cash_minor !== 0)) || lot.status !== 'active' || lot.version !== a.conversion_lot_version || lot.invoice_id !== a.invoice_id || lot.invoice_revision_id !== a.invoice_revision_id || lot.receipt_id !== receipt.id || lot.evidence_id !== a.conversion_evidence_id || lot.evidence_revision_id !== a.conversion_evidence_revision_id || lot.conversion_date !== a.conversion_date || JSON.stringify(fxRate(lot.rate)) !== JSON.stringify(a.rate)) throw new Error('Conversion lot or evidence revision changed; review complete retained history.');
        const priorInvoice = amount(lot.prior_invoice_minor), priorCash = amount(lot.prior_cash_minor);
        selectedPriorCash = currencyMinor(selectedPriorCash + priorCash);
        if (priorInvoice > matched || priorCash > allocated) throw new Error('Conversion lot exceeds retained invoice or receipt history.');
        const tranche = convertCurrencyTranche(a.rate, priorInvoice, priorCash, a.invoice_minor), conversion = tranche.after, conversionProof = evidence.get(a.conversion_evidence_id);
        if (!conversionProof || conversionProof.conversion_date !== a.conversion_date || JSON.stringify(fxRate(conversionProof.rate)) !== JSON.stringify(a.rate)) throw new Error('Conversion rate/date differs from the reviewed evidence revision.');
        const invoiceLimit = amount(conversionProof.invoice_portion_minor, true), cashLimit = amount(conversionProof.cash_portion_minor);
        if (invoiceLimit > gross || cashLimit > cash || convertCurrencyMinor(invoiceLimit, a.rate).target_minor !== cashLimit || conversion.source_minor > invoiceLimit || conversion.target_minor > cashLimit)
            throw new Error('Cumulative conversion lot exceeds its documented original/cash portions.');
        if (tranche.portion_target_minor !== a.cash_minor) throw new Error('Actual cash differs from the reviewed conversion; resolve fees or differences explicitly.');
        allocatedCash = currencyMinor(allocatedCash + a.cash_minor);
        return { invoice_id: a.invoice_id, invoice_revision_id: a.invoice_revision_id, invoice_date: invoiceDate, invoice_currency: code, invoice_minor: a.invoice_minor,
            invoice_outstanding_before_minor: outstanding, invoice_outstanding_after_minor: outstanding - a.invoice_minor, cash_currency: cashCurrency, cash_minor: a.cash_minor,
            documented_invoice_limit_minor: invoiceLimit, documented_cash_limit_minor: cashLimit,
            documented_invoice_remaining_minor: invoiceLimit - conversion.source_minor, documented_cash_remaining_minor: cashLimit - conversion.target_minor,
            conversion_lot_binding_state: lot.binding_state, conversion_date: a.conversion_date, conversion_lot_id: a.conversion_lot_id, conversion_lot_version: a.conversion_lot_version, conversion, tranche, invoice_evidence: proof(a.invoice_evidence_id, 'invoice', a.invoice_id, a.invoice_revision_id, a.invoice_evidence_revision_id), conversion_evidence: proof(a.conversion_evidence_id, 'conversion', a.invoice_id, a.invoice_revision_id, a.conversion_evidence_revision_id) };
    });
    if (selectedPriorCash > allocated) throw new Error('Selected conversion lot totals exceed retained receipt history.');
    if (allocatedCash > cash - allocated) throw new Error('Cash portions exceed the independently available receipt capacity.');
    return { intent, result: { schema_version: 'fx-settlement-review/1' as const, owner_id: owner, ruleset_id: FX_CURRENCY_RULESET, financial_stamp: intent.expected_stamp,
        receipt_id: intent.receipt_id, receipt_version: intent.receipt_version, import_id: receipt.import_id, source_row_id: receipt.source_row_id, cash_date: cashDate, value_date: valueDate,
        cash_currency: cashCurrency, observed_cash_minor: cash, previously_allocated_cash_minor: allocated, allocated_cash_minor: allocatedCash, unallocated_cash_minor: cash - allocated - allocatedCash,
        receipt_record_id: receipt.recognized_record_id, receipt_valuation_id: receipt.valuation_id, receipt_recognized_gbp_pence: gbpValue, receipt_valuation: valuation,
        recognized_income_change_pence: 0, recognized_expense_change_pence: 0, fee_mode: 'none' as const, financial_action: 'preview_only' as const, rows } };
}
