import { convertCurrencyMinor, currencyCode, currencyMinor, FX_CURRENCY_RULESET, fxRate } from './currency';
import { fxEvidenceId, parseFxEvidenceCatalog, type FxConversionDocumentData, type FxInvoiceDocumentData } from './document-facts';
import { fxSettlementReview, validateFxSettlementIntent, type FxConversionLot, type FxEvidence, type FxReceipt, type FxSettlementCatalog } from './settlement';

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Complete FX settlement context unavailable.');
    return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max = 2147483646): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Exact bounded FX count or version unavailable.');
    return value;
}
function units(value: unknown, positive = false): number {
    const n = currencyMinor(value); if (n < (positive ? 1 : 0)) throw new Error('Exact FX units unavailable.'); return n;
}
function date(value: unknown): string {
    if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9998-12-31') throw new Error('Exact FX date unavailable.');
    const time = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Real FX date unavailable.'); return value;
}
function hash(value: unknown, length = 64): string {
    if (typeof value !== 'string' || value.length !== length || !/^[a-f0-9]+$/.test(value)) throw new Error('Exact FX source hash unavailable.'); return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
    if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Supported FX source state unavailable.'); return value as T;
}
const nullableId = (v: unknown) => v === null ? null : fxEvidenceId(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const total = (values: number[]) => values.reduce((a, b) => units(a + b), 0);

/** One RPC snapshot; current approval evidence and retained reversal history stay separate.
 * Unknown properties are discarded, including on unselected rows. No private source DTO escapes.
 */
export function parseFxSettlementCatalog(ownerValue: string, value: unknown) {
    const owner = fxEvidenceId(ownerValue), p = object(value), counts = object(p.counts);
    if (p.schema_version !== 'fx-settlement-catalog/2' || p.owner_id !== owner || p.ruleset_id !== FX_CURRENCY_RULESET || p.scope !== 'external_invoice_gbp_receipt_no_fees' || p.financial_action !== 'preview_only' || !Array.isArray(p.valuations) || p.valuations.length) throw new Error('Owned GBP-cash FX settlement catalog unavailable.');
    // Bound browser/server work as well as SQL serialization. Do not truncate.
    if (new TextEncoder().encode(JSON.stringify(value)).length > 2000000) throw new Error('Complete FX settlement payload exceeds the safe limit.');
    const evidence = parseFxEvidenceCatalog(owner, p.evidence), financial_stamp = hash(p.financial_stamp, 32);
    function rows(key: 'invoices' | 'receipts' | 'lots') {
        const rows = p[key]; if (!Array.isArray(rows) || rows.length !== integer(counts[key], 0, 10000)) throw new Error('Complete FX settlement counts unavailable.');
        const ids = new Set<string>();
        return rows.map(value => { const r = object(value), id = fxEvidenceId(r.id); if (r.user_id !== owner || ids.has(id)) throw new Error('Unique owned FX settlement sources required.'); ids.add(id); return { ...r, id, user_id: owner } as Record<string, unknown> & { id: string; user_id: string }; });
    }
    const invoices = rows('invoices').map(r => {
        const invoice_minor = units(r.invoice_minor, true), allocated_minor = units(r.allocated_minor);
        if (allocated_minor > invoice_minor) throw new Error('Original invoice capacity is inconsistent.');
        return { id: r.id, user_id: owner, revision_id: fxEvidenceId(r.revision_id), source_fact_revision_id: fxEvidenceId(r.source_fact_revision_id),
            status: choice(r.status, ['finalised'] as const), invoice_date: date(r.invoice_date), currency: currencyCode(r.currency), invoice_minor,
            allocated_minor, allocated_cash_pence: units(r.allocated_cash_pence) };
    });
    const receipts = rows('receipts').map(r => {
        if (r.currency !== 'GBP') throw new Error('Only observed GBP receipts are supported here.');
        const signed_minor = units(r.signed_minor, true), allocated_minor = units(r.allocated_minor), record = nullableId(r.recognized_record_id);
        if (allocated_minor > signed_minor) throw new Error('Shared receipt capacity is inconsistent.');
        if (record === null && [r.record_transaction_id, r.record_type, r.record_status, r.effect_sign, r.recognized_gbp_pence].some(v => v !== null)) throw new Error('Missing recognised receipt metadata is not zero.');
        if (record !== null && [r.record_type, r.record_status, r.effect_sign, r.recognized_gbp_pence].some(v => v === null) || (r.effect_sign !== null && r.effect_sign !== -1 && r.effect_sign !== 1)) throw new Error('Complete recognised receipt fields required.');
        return { id: r.id, user_id: owner, import_id: fxEvidenceId(r.import_id), source_row_id: fxEvidenceId(r.source_row_id), transaction_date: date(r.transaction_date), currency: 'GBP' as const,
            signed_minor, allocated_minor, active_refund_count: integer(r.active_refund_count, 0), decision_version: integer(r.decision_version, 0), classification: choice(r.classification, ['Business','Personal','Mixed','Transfer','Refund','Unknown'] as const),
            business_use_bps: integer(r.business_use_bps, 0, 10000), dedupe_status: choice(r.dedupe_status, ['clear','needs_review','duplicate'] as const),
            active_transfer_id: nullableId(r.active_transfer_id), active_refund_id: nullableId(r.active_refund_id), import_status: choice(r.import_status, ['review','committed','discarded'] as const),
            recognized_record_id: record, record_transaction_id: r.record_transaction_id === null ? null : fxEvidenceId(r.record_transaction_id),
            record_type: r.record_type === null ? null : choice(r.record_type, ['income','expense'] as const), record_status: r.record_status === null ? null : choice(r.record_status, ['draft','review','approved','excluded'] as const),
            effect_sign: r.effect_sign === null ? null : integer(r.effect_sign, -1, 1), recognized_gbp_pence: r.recognized_gbp_pence === null ? null : units(r.recognized_gbp_pence) };
    });
    // The nested evidence catalog covers precisely the same positive GBP observations.
    if (receipts.length !== evidence.receipts.length) throw new Error('Complete receipt/evidence closure unavailable.');
    for (const r of receipts) {
        const e = evidence.receipts.find(e => e.id === r.id);
        if (!e || e.import_id !== r.import_id || e.source_row_id !== r.source_row_id || e.transaction_date !== r.transaction_date || e.signed_amount_pence !== r.signed_minor || e.decision_version !== r.decision_version || e.classification !== r.classification || e.dedupe_status !== r.dedupe_status || e.import_status !== r.import_status || e.active_transfer_id !== r.active_transfer_id || e.active_refund_id !== r.active_refund_id) throw new Error('Contradictory receipt/evidence snapshot.');
    }
    const lots = rows('lots').map(r => {
        const rate = fxRate(r.rate), invoice_currency = currencyCode(r.invoice_currency), invoice_limit_minor = units(r.invoice_limit_minor, true), cash_limit_minor = units(r.cash_limit_minor);
        const version = integer(r.version, 0), active_count = integer(r.active_count, 0, 10000), prior_invoice_minor = units(r.prior_invoice_minor), prior_cash_minor = units(r.prior_cash_minor);
        if (r.ruleset_id !== FX_CURRENCY_RULESET || r.cash_currency !== 'GBP' || rate.source_currency !== invoice_currency || rate.target_currency !== 'GBP' || convertCurrencyMinor(invoice_limit_minor, rate).target_minor !== cash_limit_minor || convertCurrencyMinor(prior_invoice_minor, rate).target_minor !== prior_cash_minor || prior_invoice_minor > invoice_limit_minor || prior_cash_minor > cash_limit_minor || active_count > version || (version - active_count) % 2 !== 0 || prior_invoice_minor < active_count || (active_count === 0 && (prior_invoice_minor !== 0 || prior_cash_minor !== 0))) throw new Error('Retained conversion lot history is inconsistent.');
        return { id: r.id, user_id: owner, binding_state: 'persisted' as const, invoice_id: fxEvidenceId(r.invoice_id), invoice_revision_id: fxEvidenceId(r.invoice_revision_id), invoice_fact_revision_id: fxEvidenceId(r.invoice_fact_revision_id),
            invoice_document_id: fxEvidenceId(r.invoice_document_id), invoice_document_sha256: hash(r.invoice_document_sha256), conversion_document_id: fxEvidenceId(r.conversion_document_id), conversion_document_sha256: hash(r.conversion_document_sha256),
            conversion_family_id: fxEvidenceId(r.conversion_family_id), conversion_fact_revision_id: fxEvidenceId(r.conversion_fact_revision_id), receipt_id: fxEvidenceId(r.receipt_id), receipt_version: integer(r.receipt_version, 0),
            ruleset_id: FX_CURRENCY_RULESET, invoice_currency, cash_currency: 'GBP' as const, invoice_limit_minor, cash_limit_minor, rate, conversion_date: date(r.conversion_date), evidence_date: date(r.evidence_date), version, active_count, prior_invoice_minor, prior_cash_minor };
    });
    if (new Set(lots.map(l => l.conversion_family_id)).size !== lots.length || new Set(lots.map(l => l.conversion_fact_revision_id)).size !== lots.length || new Set(lots.map(l => JSON.stringify([l.invoice_revision_id,l.receipt_id,l.conversion_document_id,l.rate,l.conversion_date]))).size !== lots.length) throw new Error('Conversion history cannot reset its family or recipe.');
    for (const l of lots) {
        const i = invoices.find(i => i.id === l.invoice_id), r = receipts.find(r => r.id === l.receipt_id);
        if (!i || !r || l.prior_invoice_minor > i.allocated_minor || l.prior_cash_minor > r.allocated_minor) throw new Error('Retained lot/source closure unavailable.');
    }
    for (const i of invoices) {
        const linked = lots.filter(l => l.invoice_id === i.id);
        if (total(linked.map(l => l.prior_invoice_minor)) !== i.allocated_minor || total(linked.map(l => l.prior_cash_minor)) !== i.allocated_cash_pence) throw new Error('Complete invoice/lot balance closure unavailable.');
    }
    for (const r of receipts) if (total(lots.filter(l => l.receipt_id === r.id).map(l => l.prior_cash_minor)) > r.allocated_minor) throw new Error('FX lots exceed shared native/FX cash.');
    return { schema_version: 'fx-settlement-catalog/2' as const, owner_id: owner, ruleset_id: FX_CURRENCY_RULESET, financial_stamp,
        scope: 'external_invoice_gbp_receipt_no_fees' as const, counts: { invoices: invoices.length, receipts: receipts.length, lots: lots.length }, invoices, receipts, lots, evidence, valuations: [] as never[], financial_action: 'preview_only' as const };
}
export type FxAuthoritativeCatalog = ReturnType<typeof parseFxSettlementCatalog>;

function eligibleReceipt(r: FxAuthoritativeCatalog['receipts'][number]): r is FxAuthoritativeCatalog['receipts'][number] & { recognized_record_id: string; record_transaction_id: string; record_type: 'income'; record_status: 'approved'; effect_sign: 1; recognized_gbp_pence: number } {
    return ['review','committed'].includes(r.import_status) && r.classification === 'Business' && r.business_use_bps === 10000 && r.dedupe_status === 'clear' && !r.active_transfer_id && !r.active_refund_id && r.active_refund_count === 0 && r.recognized_record_id !== null && r.record_transaction_id === r.id && r.record_type === 'income' && r.record_status === 'approved' && r.effect_sign === 1 && r.recognized_gbp_pence === r.signed_minor;
}
/** Approval choices do not replace retained lots: withdrawn/stale lots remain reversible. */
export function fxSettlementChoices(c: FxAuthoritativeCatalog) {
    const currentSource = (f: FxAuthoritativeCatalog['evidence']['facts'][number]) => {
        const doc = c.evidence.documents.find(d => d.id === f.document_id);
        return !!doc?.source.available && same(doc.source, f.source_snapshot.document_source);
    };
    return c.evidence.facts.filter(f => f.kind === 'conversion').map(f => {
        const data = f.data as FxConversionDocumentData, i = c.invoices.find(i => i.source_fact_revision_id === f.invoice_evidence_revision_id), parent = c.evidence.facts.find(p => p.id === f.invoice_evidence_revision_id && p.kind === 'invoice'), r = c.receipts.find(r => r.id === f.transaction_id), bound = c.lots.find(l => l.conversion_family_id === f.family_id);
        const original = parent?.data as FxInvoiceDocumentData | undefined;
        const conflict = i && r ? c.lots.find(l => l.invoice_revision_id === i.revision_id && l.receipt_id === r.id && l.conversion_document_id === f.document_id && same(l.rate, data.rate) && l.conversion_date === data.conversion_date && l.id !== bound?.id) : undefined;
        let blocked_reason: string | null = null;
        if (!f.usable || !currentSource(f)) blocked_reason = 'conversion_evidence_unavailable';
        else if (!i || !parent || !parent.usable || !currentSource(parent) || !original || original.currency !== i.currency || original.original_total_minor !== i.invoice_minor || original.invoice_date !== i.invoice_date) blocked_reason = 'canonical_invoice_evidence_changed';
        else if (!r || !eligibleReceipt(r)) blocked_reason = 'receipt_unavailable';
        else if (f.transaction_version !== r.decision_version || f.source_snapshot.receipt?.decision_version !== r.decision_version || f.source_snapshot.receipt?.id !== r.id || f.source_snapshot.receipt?.import_id !== r.import_id || f.source_snapshot.receipt?.source_row_id !== r.source_row_id || f.source_snapshot.receipt?.transaction_date !== r.transaction_date || f.source_snapshot.receipt?.signed_amount_pence !== r.signed_minor || !same(f.source_snapshot.invoice_evidence?.data, parent.data) || f.source_snapshot.invoice_evidence?.document_id !== parent.document_id || f.source_snapshot.invoice_evidence?.family_id !== parent.family_id) blocked_reason = 'receipt_version_changed';
        else if (data.rate.source_currency !== i.currency || data.invoice_portion_minor > i.invoice_minor || data.gbp_cash_portion_pence > r.signed_minor) blocked_reason = 'documented_capacity_changed';
        else if (bound && (bound.invoice_id !== i.id || bound.invoice_revision_id !== i.revision_id || bound.invoice_fact_revision_id !== parent.id || bound.receipt_id !== r.id || bound.receipt_version !== r.decision_version || bound.conversion_fact_revision_id !== f.id || bound.conversion_document_id !== f.document_id || bound.invoice_document_id !== parent.document_id || bound.invoice_document_sha256 !== parent.source_snapshot.document_source.document.file_sha256 || bound.conversion_document_sha256 !== f.source_snapshot.document_source.document.file_sha256 || !same(bound.rate, data.rate) || bound.invoice_limit_minor !== data.invoice_portion_minor || bound.cash_limit_minor !== data.gbp_cash_portion_pence || bound.conversion_date !== data.conversion_date || bound.evidence_date !== data.evidence_date)) blocked_reason = 'bound_evidence_changed';
        else if (conflict) blocked_reason = 'recipe_already_bound';
        else if (bound && bound.active_count >= 10000) blocked_reason = 'complete_reversal_limit';
        else if (i && i.invoice_minor === i.allocated_minor) blocked_reason = 'invoice_fully_allocated';
        else if (bound && bound.prior_invoice_minor === bound.invoice_limit_minor) blocked_reason = 'documented_original_fully_allocated';
        return { conversion_family_id: f.family_id, conversion_fact_revision_id: f.id, invoice_id: i?.id ?? null, invoice_revision_id: i?.revision_id ?? null, receipt_id: f.transaction_id,
            remaining_invoice_minor: i ? i.invoice_minor - i.allocated_minor : null, remaining_documented_invoice_minor: data.invoice_portion_minor - (bound?.prior_invoice_minor ?? 0), available_cash_minor: r ? r.signed_minor - r.allocated_minor : null,
            binding_state: bound ? 'persisted' as const : 'unbound' as const, lot_id: bound?.id ?? null, lot_version: bound?.version ?? 0, eligible: blocked_reason === null, blocked_reason };
    });
}

/** Strict authoritative adapter; a proposed UUID remains review state, not a saved lot. */
export function authoritativeFxSettlementReview(owner: string, value: unknown, raw: unknown) {
    const c = parseFxSettlementCatalog(owner, raw), intent = validateFxSettlementIntent(value), choices = fxSettlementChoices(c), selected: FxConversionLot[] = [], evidence: FxEvidence[] = [];
    for (const a of intent.allocations) {
        const choice = choices.find(c => c.conversion_fact_revision_id === a.conversion_evidence_revision_id);
        if (!choice?.eligible || choice.invoice_id !== a.invoice_id || choice.invoice_revision_id !== a.invoice_revision_id || choice.receipt_id !== intent.receipt_id || choice.conversion_family_id !== a.conversion_evidence_id) throw new Error('Current complete FX source choice changed.');
        const f = c.evidence.facts.find(f => f.id === a.conversion_evidence_revision_id)!;
        // Resolve the parent explicitly: canonical revision IDs and fact revision IDs differ.
        const invoiceFact = c.evidence.facts.find(p => p.id === f.invoice_evidence_revision_id && p.kind === 'invoice');
        if (!invoiceFact || invoiceFact.family_id !== a.invoice_evidence_id || invoiceFact.id !== a.invoice_evidence_revision_id) throw new Error('Exact captured invoice fact/family changed.');
        const data = f.data as FxConversionDocumentData, lot = choice.lot_id ? c.lots.find(l => l.id === choice.lot_id)! : null;
        if (lot ? a.conversion_lot_id !== lot.id || a.conversion_lot_version !== lot.version : a.conversion_lot_version !== 0 || c.lots.some(l => l.id === a.conversion_lot_id)) throw new Error('Reuse the authoritative lot identity and all-event version.');
        selected.push({ id: a.conversion_lot_id, user_id: c.owner_id, invoice_id: a.invoice_id, invoice_revision_id: a.invoice_revision_id, receipt_id: intent.receipt_id,
            evidence_id: f.family_id, evidence_revision_id: f.id, version: lot?.version ?? 0, rate: data.rate, conversion_date: data.conversion_date,
            prior_invoice_minor: lot?.prior_invoice_minor ?? 0, prior_cash_minor: lot?.prior_cash_minor ?? 0, status: 'active', binding_state: lot ? 'persisted' : 'proposed' });
        for (const fact of [invoiceFact,f]) {
            const d = fact.data as FxConversionDocumentData, invoice = fact.kind === 'invoice';
            evidence.push({ id: fact.family_id, user_id: c.owner_id, revision_id: fact.id, document_id: fact.document_id, document_sha256: fact.source_snapshot.document_source.document.file_sha256,
                status: 'verified', purpose: invoice ? 'invoice' : 'conversion', invoice_id: a.invoice_id, invoice_revision_id: a.invoice_revision_id, receipt_id: invoice ? null : intent.receipt_id,
                evidence_date: invoice ? (fact.data as FxInvoiceDocumentData).invoice_date : d.evidence_date, conversion_date: invoice ? null : d.conversion_date, rate: invoice ? null : d.rate,
                invoice_portion_minor: invoice ? null : d.invoice_portion_minor, cash_portion_minor: invoice ? null : d.gbp_cash_portion_pence });
        }
    }
    const catalog: FxSettlementCatalog = { owner_id: c.owner_id, ruleset_id: c.ruleset_id, financial_stamp: c.financial_stamp,
        invoices: c.invoices.map(i => ({ ...i, credited_minor: 0, returned_minor: 0 })),
        receipts: c.receipts.filter(eligibleReceipt).map(r => ({ ...r, valuation_id: null, value_date: r.transaction_date })) as FxReceipt[],
        evidence, conversion_lots: selected, valuations: [] };
    return fxSettlementReview(owner, intent, catalog);
}
