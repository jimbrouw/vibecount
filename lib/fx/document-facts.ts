import { redactBankDetailsForPrompt } from '../ai/redaction';
import { convertCurrencyMinor, currencyCode, currencyMinor, exactObject, FX_CURRENCY_RULESET, fxRate, type CurrencyCode, type FxRate } from './currency';

export type FxInvoiceDocumentData = { currency: CurrencyCode; original_total_minor: number; invoice_date: string; invoice_reference: string };
export type FxConversionDocumentData = { rate: FxRate; conversion_date: string; evidence_date: string; invoice_portion_minor: number; gbp_cash_portion_pence: number; fee_mode: 'none' };
export type FxDocumentFactIntent = {
    schema_version: 'fx-document-fact-intent/1'; ruleset_id: typeof FX_CURRENCY_RULESET; family_id: string; expected_ordinal: number;
    kind: 'invoice' | 'conversion'; state: 'provisional' | 'verified' | 'withdrawn'; document_id: string | null;
    invoice_evidence_revision_id: string | null; transaction_id: string | null; transaction_version: number | null;
    data: FxInvoiceDocumentData | FxConversionDocumentData | null; human_read_original: boolean; expected_stamp: string; rationale: string; request_id: string;
};
export function fxEvidenceId(value: unknown): string {
    if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Review an exact evidence identity.'); return value.toLowerCase();
}
function nullableId(value: unknown): string | null { return value === null ? null : fxEvidenceId(value); }
function integer(value: unknown, min: number, max: number): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Review a bounded exact count or version.'); return value; }
function money(value: unknown, positive = false) { const n = currencyMinor(value); if (n < (positive ? 1 : 0)) throw new Error('Review exact original/cash minor units.'); return n; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Review an explicit confirmation or source state.'); return value; }
function stamp(value: unknown): string { if (typeof value !== 'string' || value.length !== 32 || !/^[a-f0-9]{32}$/.test(value)) throw new Error('Review the complete FX context stamp.'); return value; }
function date(value: unknown): string {
    if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9998-12-31') throw new Error('Review a supported exact date.');
    const n = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('Review a real calendar date.'); return value;
}
export function validateFxDocumentData(kind: 'invoice' | 'conversion', value: unknown): FxInvoiceDocumentData | FxConversionDocumentData {
    if (kind === 'invoice') {
        const d = exactObject(value, ['currency', 'original_total_minor', 'invoice_date', 'invoice_reference']);
        if (typeof d.invoice_reference !== 'string' || d.invoice_reference.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(d.invoice_reference) || d.invoice_reference !== d.invoice_reference.trim()) throw new Error('Review the bounded invoice reference, not free private text.');
        return { currency: currencyCode(d.currency), original_total_minor: money(d.original_total_minor, true), invoice_date: date(d.invoice_date), invoice_reference: d.invoice_reference };
    }
    const d = exactObject(value, ['rate', 'conversion_date', 'evidence_date', 'invoice_portion_minor', 'gbp_cash_portion_pence', 'fee_mode']);
    if (d.fee_mode !== 'none') throw new Error('Fee and gross-up treatment requires separate supported review.');
    const rate = fxRate(d.rate), original = money(d.invoice_portion_minor, true), cash = money(d.gbp_cash_portion_pence);
    if (rate.target_currency !== 'GBP' || convertCurrencyMinor(original, rate).target_minor !== cash) throw new Error('Review the explicit original-to-GBP conversion and resolve differences.');
    return { rate, conversion_date: date(d.conversion_date), evidence_date: date(d.evidence_date), invoice_portion_minor: original, gbp_cash_portion_pence: cash, fee_mode: 'none' };
}
export function validateFxDocumentFactIntent(value: unknown): FxDocumentFactIntent {
    const p = exactObject(value, ['schema_version','ruleset_id','family_id','expected_ordinal','kind','state','document_id','invoice_evidence_revision_id','transaction_id','transaction_version','data','human_read_original','expected_stamp','rationale','request_id']);
    if (p.schema_version !== 'fx-document-fact-intent/1' || p.ruleset_id !== FX_CURRENCY_RULESET || typeof p.kind !== 'string' || !['invoice','conversion'].includes(p.kind) || typeof p.state !== 'string' || !['provisional','verified','withdrawn'].includes(p.state)) throw new Error('Review supported FX document facts.');
    const kind = p.kind as FxDocumentFactIntent['kind'], state = p.state as FxDocumentFactIntent['state'], read = bool(p.human_read_original);
    const doc = nullableId(p.document_id), parent = nullableId(p.invoice_evidence_revision_id), tx = nullableId(p.transaction_id);
    const version = p.transaction_version === null ? null : integer(p.transaction_version, 0, 2147483647);
    if (typeof p.rationale !== 'string' || !p.rationale.trim() || p.rationale.trim().length > 1000) throw new Error('Explain this evidence review.');
    const rationale = redactBankDetailsForPrompt(p.rationale.trim()); if (rationale.length > 1000) throw new Error('Shorten the reason without private details.');
    let data: FxDocumentFactIntent['data'] = null;
    if (state === 'withdrawn') { if (read || doc !== null || parent !== null || tx !== null || version !== null || p.data !== null) throw new Error('Withdrawal copies the previous exact source snapshot.'); }
    else {
        if (doc === null || (state === 'verified' && !read)) throw new Error('Choose preserved evidence and confirm human original-document review.');
        if (kind === 'invoice' ? parent !== null || tx !== null || version !== null : parent === null || tx === null || version === null) throw new Error('Pin exactly the supported invoice evidence and receipt version.');
        data = validateFxDocumentData(kind, p.data);
    }
    return { schema_version: 'fx-document-fact-intent/1', ruleset_id: FX_CURRENCY_RULESET, family_id: fxEvidenceId(p.family_id), expected_ordinal: integer(p.expected_ordinal, 0, 2147483646), kind, state, document_id: doc, invoice_evidence_revision_id: parent, transaction_id: tx, transaction_version: version, data, human_read_original: read, expected_stamp: stamp(p.expected_stamp), rationale, request_id: fxEvidenceId(p.request_id) };
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Complete FX source context unavailable.'); return value as Record<string, unknown>; }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T)) throw new Error('Unsupported persisted FX source state.'); return value as T; }
function documentSource(value: unknown) {
    const p = record(value), d = record(p.document), r = record(p.registration);
    if (typeof d.file_sha256 !== 'string' || d.file_sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(d.file_sha256)) throw new Error('Retained document hash unavailable.');
    return { document: { id: fxEvidenceId(d.id), file_sha256: d.file_sha256, media_type: choice(d.media_type, ['application/pdf','image/png','image/jpeg'] as const), size_bytes: integer(d.size_bytes,1,3000000) }, available: bool(p.available), invoice_scope: bool(p.invoice_scope),
        registration: { item_id: fxEvidenceId(r.item_id), batch_id: fxEvidenceId(r.batch_id), ordinal: integer(r.ordinal,0,100), purpose: choice(r.purpose,['invoice','receipt','employment','other'] as const), tax_year_start: integer(r.tax_year_start,2000,2100) } };
}
function receiptSnapshot(value: unknown) {
    const r = record(value); if (r.currency !== 'GBP') throw new Error('Review an owned GBP receipt source.');
    return { id: fxEvidenceId(r.id), import_id: fxEvidenceId(r.import_id), source_row_id: fxEvidenceId(r.source_row_id), transaction_date: date(r.transaction_date), signed_amount_pence: money(r.signed_amount_pence,true), currency: 'GBP' as const, decision_version: integer(r.decision_version,0,2147483647), classification: choice(r.classification,['Business','Personal','Mixed','Transfer','Refund','Unknown'] as const), dedupe_status: choice(r.dedupe_status,['clear','needs_review','duplicate'] as const) };
}
function sourceSnapshot(value: unknown, kind: 'invoice' | 'conversion') {
    const p = record(value), source = documentSource(p.document_source);
    if (kind === 'invoice') return { document_source: source };
    const i = record(p.invoice_evidence);
    return { document_source: source, invoice_evidence: { id: fxEvidenceId(i.id), family_id: fxEvidenceId(i.family_id), ordinal: integer(i.ordinal,1,2147483647), data: validateFxDocumentData('invoice',i.data) as FxInvoiceDocumentData, document_id: fxEvidenceId(i.document_id) }, receipt: receiptSnapshot(p.receipt) };
}
/** Generic registered PDF/image metadata; does not assert invoice or valuation eligibility. */
export function parseRegisteredDocumentSource(value: unknown) { return documentSource(value); }
/** Safe retained source projection shared by immutable proof readers. */
export function parseFxSourceSnapshot(value: unknown, kind: 'invoice' | 'conversion') { return sourceSnapshot(value, kind); }
/** Rebuild the allowlist even though the owner-derived RPC also projects it. */
export function parseFxEvidenceCatalog(ownerValue: string, value: unknown) {
    const owner = fxEvidenceId(ownerValue), p = record(value), c = record(p.counts);
    if (p.schema_version !== 'fx-evidence-catalog/1' || p.owner_id !== owner || p.ruleset_id !== FX_CURRENCY_RULESET || p.financial_action !== 'evidence_preparation_only') throw new Error('Owned FX evidence catalog unavailable.');
    function rows(key: 'documents' | 'receipts' | 'facts') { const list = p[key], n = integer(c[key],0,10000); if (!Array.isArray(list) || list.length !== n) throw new Error('Complete FX evidence counts unavailable.'); return list; }
    const documents = rows('documents').map(value => { const d = record(value), source = documentSource(d.source), id = fxEvidenceId(d.id); if (id !== source.document.id) throw new Error('Document source identity mismatch.'); return { id, source }; });
    const receipts = rows('receipts').map(value => { const r = record(value); if (r.user_id !== owner) throw new Error('Receipt source is not owned.'); return { ...receiptSnapshot(r), user_id: owner, active_transfer_id: nullableId(r.active_transfer_id), active_refund_id: nullableId(r.active_refund_id), import_status: choice(r.import_status,['review','committed','discarded'] as const) }; });
    const facts = rows('facts').map(value => {
        const r = record(value), kind = choice(r.kind,['invoice','conversion'] as const), state = choice(r.state,['provisional','verified','withdrawn'] as const), read = bool(r.human_read_original), current = bool(r.source_current), usable = bool(r.usable);
        if (r.ruleset_id !== FX_CURRENCY_RULESET || usable !== (state === 'verified' && current) || (state === 'verified' && !read) || (state === 'withdrawn' && read)) throw new Error('Contradictory reviewed FX evidence state.');
        const snapshot = sourceSnapshot(r.source_snapshot,kind), doc = fxEvidenceId(r.document_id), parent = nullableId(r.invoice_evidence_revision_id), tx = nullableId(r.transaction_id), version = r.transaction_version === null ? null : integer(r.transaction_version,0,2147483647);
        if (snapshot.document_source.document.id !== doc || (kind === 'invoice' ? parent !== null || tx !== null || version !== null : !snapshot.invoice_evidence || !snapshot.receipt || snapshot.invoice_evidence.id !== parent || snapshot.receipt.id !== tx || snapshot.receipt.decision_version !== version)) throw new Error('Complete retained FX source provenance unavailable.');
        return { id: fxEvidenceId(r.id), family_id: fxEvidenceId(r.family_id), kind, ordinal: integer(r.ordinal,1,2147483647), state, ruleset_id: FX_CURRENCY_RULESET, document_id: doc, invoice_evidence_revision_id: parent, transaction_id: tx, transaction_version: version, data: validateFxDocumentData(kind,r.data), source_snapshot: snapshot, human_read_original: read, source_current: current, usable };
    });
    for (const list of [documents,receipts,facts]) if (new Set(list.map(r=>r.id)).size !== list.length) throw new Error('Duplicate FX source identities.');
    if (new Set(facts.map(r=>r.family_id)).size !== facts.length) throw new Error('Expected only the latest fact per family.');
    return { schema_version:'fx-evidence-catalog/1' as const, owner_id:owner, ruleset_id:FX_CURRENCY_RULESET, stamp:stamp(p.stamp), counts:{documents:documents.length,receipts:receipts.length,facts:facts.length}, documents,receipts,facts,financial_action:'evidence_preparation_only' as const };
}
export type FxEvidenceCatalog = ReturnType<typeof parseFxEvidenceCatalog>;
/** Draft read-back only. The authenticated writer independently rebuilds sources. */
export function fxDocumentFactReadback(owner: string, value: unknown, context: unknown) {
    const intent = validateFxDocumentFactIntent(value), catalog = parseFxEvidenceCatalog(owner,context), previous = catalog.facts.find(f=>f.family_id===intent.family_id);
    if (intent.expected_stamp !== catalog.stamp || (previous?.ordinal ?? 0) !== intent.expected_ordinal || (previous && previous.kind !== intent.kind)) throw new Error('Evidence family or source context changed.');
    if (intent.state === 'withdrawn') { if (!previous) throw new Error('Choose existing evidence to withdraw.'); return {intent, result:{state:intent.state,kind:intent.kind,retained_source:previous.source_snapshot,retained_source_current:previous.source_current,prior_state:previous.state,retained_data:previous.data,financial_action:'evidence_preparation_only',recognized_income_change_pence:0,recognized_expense_change_pence:0}}; }
    const document = catalog.documents.find(d=>d.id===intent.document_id);
    if (!document?.source.available || (intent.kind==='invoice' && (!document.source.invoice_scope || document.source.registration.purpose!=='invoice'))) throw new Error('Preserve a registered PDF/image in the supported source scope.');
    if (intent.kind==='invoice' && intent.state==='verified' && catalog.facts.some(f=>f.family_id!==intent.family_id && f.kind==='invoice' && f.state==='verified' && f.document_id===intent.document_id && (f.data as FxInvoiceDocumentData).invoice_reference.toLowerCase()===(intent.data as FxInvoiceDocumentData).invoice_reference.toLowerCase())) throw new Error('Revise the existing reviewed invoice facts for this document reference.');
    let comparison = null, receipt = null, invoice = null;
    if (intent.kind === 'conversion') {
        invoice = catalog.facts.find(f=>f.id===intent.invoice_evidence_revision_id && f.kind==='invoice' && f.usable);
        receipt = catalog.receipts.find(r=>r.id===intent.transaction_id && r.decision_version===intent.transaction_version && r.import_status!=='discarded');
        if (!invoice || !receipt) throw new Error('Review the current verified invoice evidence and receipt version.');
        const data = intent.data as FxConversionDocumentData, original = invoice.data as FxInvoiceDocumentData;
        if (data.rate.source_currency!==original.currency || data.invoice_portion_minor>original.original_total_minor || data.gbp_cash_portion_pence>receipt.signed_amount_pence) throw new Error('Review portions within the original invoice and observed cash.');
        comparison = convertCurrencyMinor(data.invoice_portion_minor,data.rate);
    }
    return {intent,result:{state:intent.state,kind:intent.kind,document:document.source,invoice,receipt,data:intent.data,comparison,financial_action:'evidence_preparation_only',recognized_income_change_pence:0,recognized_expense_change_pence:0}};
}

/** Separate history contract: immutable past revisions have no inferred current eligibility. */
export function parseFxEvidenceHistory(owner: string, value: unknown) {
    if (!Array.isArray(value) || value.length>21) throw new Error('Evidence revision history unavailable.');
    const rows=value.map(value=>{
        const r=record(value);
        if(r.user_id!==fxEvidenceId(owner) || typeof r.created_at!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.created_at) || !Number.isFinite(Date.parse(r.created_at))) throw new Error('Owned evidence revision history unavailable.');
        const parsed=parseFxEvidenceCatalog(owner,{schema_version:'fx-evidence-catalog/1',owner_id:owner,ruleset_id:FX_CURRENCY_RULESET,stamp:'0'.repeat(32),counts:{documents:0,receipts:0,facts:1},documents:[],receipts:[],facts:[{...r,source_current:false,usable:false}],financial_action:'evidence_preparation_only'});
        if(r.author!==fxEvidenceId(owner) || typeof r.rationale!=='string' || !r.rationale.trim() || r.rationale.length>1000)throw new Error('Evidence review authorship unavailable.');
        return {...parsed.facts[0],created_at:r.created_at,author:fxEvidenceId(r.author),rationale:redactBankDetailsForPrompt(r.rationale)};
    });
    if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Duplicate evidence history identities.');
    return rows;
}
export function validateFxEvidenceResult(value: unknown, intent: FxDocumentFactIntent) {
    const r=exactObject(value,['family_id','revision_id','ordinal','state','kind','financial_action','recognized_income_change_pence','recognized_expense_change_pence','canonical_invoice_change','settlement_change']);
    if(fxEvidenceId(r.family_id)!==intent.family_id || integer(r.ordinal,1,2147483647)!==intent.expected_ordinal+1 || r.state!==intent.state || r.kind!==intent.kind || r.financial_action!=='evidence_preparation_only' || [r.recognized_income_change_pence,r.recognized_expense_change_pence,r.canonical_invoice_change,r.settlement_change].some(v=>v!==0))throw new Error('Evidence review result unavailable.');
    return {family_id:intent.family_id,revision_id:fxEvidenceId(r.revision_id),ordinal:r.ordinal,state:intent.state};
}
