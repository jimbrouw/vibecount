import { minorPence, type ReceiptBalance, type InvoiceBalance } from './allocations';
export const MATCH_RULES_VERSION = 'invoice-match/1';
export type MatchReceipt = ReceiptBalance & {
    import_id: string;
    transaction_date: string;
    description: string;
    reference: string;
    record_type: string | null;
    active_transfer_id: string | null;
};
export type MatchInvoice = InvoiceBalance & {
    invoice_date: string;
    client_id: string;
    client_name: string;
};
export type MatchProposal = {
    invoice_id: string;
    amount_pence: number;
    invoice_updated_at: string;
    strength: 'strong' | 'review';
    reasons: string[];
    warnings: string[];
    score: number;
    rules_version: string;
    ambiguous: boolean;
};
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/([\p{L}])([\p{N}])/gu, '$1 $2').replace(/([\p{N}])([\p{L}])/gu, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const contains = (text: string, term: string) => (' ' + text + ' ').includes(' ' + term + ' ');
function invoiceReference(number: string) { const text = normalize(number), compact = text.replaceAll(' ', ''); return compact.length >= 4 && /[\p{L}]/u.test(compact) && /\d/.test(compact) ? text : null; }
function day(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error('Review the source date.');
    const n = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value)
        throw new Error('Review the source date.');
    return n / 86400000;
}
export function canMatchReceipt(receipt: MatchReceipt) { return receipt.currency === 'GBP' && receipt.classification === 'Business' && receipt.business_use_bps === 10000 && receipt.dedupe_status === 'clear' && receipt.record_status === 'approved' && receipt.record_type === 'income' && !receipt.active_transfer_id && !receipt.active_refund_id && minorPence(receipt.signed_amount_pence) > 0 && minorPence(receipt.unallocated_pence) > 0 && receipt.recognized_pence !== null && minorPence(receipt.recognized_pence) === minorPence(receipt.signed_amount_pence); }
/** Evidence ranking only. Selecting a proposal still requires exact human read-back and approval. */
export function proposeInvoiceMatches(receipt: MatchReceipt, invoices: MatchInvoice[]): MatchProposal[] {
    if (!canMatchReceipt(receipt))
        return [];
    const text = normalize(receipt.reference + ' ' + receipt.description), available = minorPence(receipt.unallocated_pence), paid = day(receipt.transaction_date), proposals: MatchProposal[] = [], referenced = new Set(invoices.filter(i => { const ref = invoiceReference(i.number); return ref && contains(text, ref); }).map(i => i.id));
    for (const invoice of invoices) {
        if (invoice.currency !== 'GBP' || invoice.status !== 'finalised')
            continue;
        const outstanding = minorPence(invoice.outstanding_pence);
        if (outstanding <= 0)
            continue;
        const reference = invoiceReference(invoice.number), ref = reference !== null && contains(text, reference);
        const client = normalize(invoice.client_name), words = client.split(' ').filter(w => !['the', 'and', 'ltd', 'limited', 'company', 'studio', 'client', 'test', 'synthetic'].includes(w)), distinctName = words.join('').length >= 8 && (words.length >= 2 || words[0]?.length >= 8), payer = distinctName && client.length > 0 && contains(text, client), exact = available === outstanding, days = paid - day(invoice.invoice_date), near = days >= 0 && days <= 120;
        if (!ref && !payer && !exact)
            continue;
        const reasons: string[] = [], warnings: string[] = [];
        if (ref)
            reasons.push('Bounded invoice reference matches the receipt.');
        if (payer)
            reasons.push('Distinctive client name appears in the receipt.');
        if (exact)
            reasons.push('Remaining receipt equals current invoice outstanding.');
        else if (ref || payer)
            reasons.push(available < outstanding ? 'Receipt can partially settle this invoice.' : 'Invoice can be settled while leaving receipt cash unallocated.');
        if (near)
            reasons.push('Receipt is within 120 days after the invoice.');
        if (referenced.size > 0 && !ref)
            warnings.push('Receipt references another known invoice; do not infer this match from payer and amount.');
        if (referenced.size > 1)
            warnings.push('Receipt references multiple invoices; review the allocation across them.');
        if (days < 0)
            warnings.push('Receipt predates the invoice; review any advance payment.');
        if (days > 120)
            warnings.push('Receipt is more than 120 days after the invoice.');
        if (!ref && !payer)
            warnings.push('Equal amounts alone do not establish who paid or which invoice was settled.');
        if (minorPence(receipt.refunded_pence ?? 0) > 0)
            warnings.push('Recorded refunds still need their separate credit/correction review.');
        proposals.push({ invoice_id: invoice.id, invoice_updated_at: invoice.updated_at, amount_pence: Math.min(available, outstanding), strength: (ref || (payer && exact && near)) && days >= 0 && referenced.size <= 1 && (!referenced.size || ref) ? 'strong' : 'review', score: (ref ? 100 : 0) + (payer ? 50 : 0) + (exact ? 20 : 0) + (near ? 5 : 0), reasons, warnings, rules_version: MATCH_RULES_VERSION, ambiguous: false });
    }
    proposals.sort((a, b) => b.score - a.score || a.invoice_id.localeCompare(b.invoice_id));
    const top = proposals[0];
    if (top) {
        const tied = proposals.filter(p => p.score === top.score);
        if (tied.length > 1)
            for (const p of tied) {
                p.ambiguous = true;
                p.strength = 'review';
                p.warnings.push(`${tied.length} alternatives have equal matching evidence. Choose explicitly; ordering does not imply identity.`);
            }
    }
    return proposals;
}
export function receiptQueue(receipts: MatchReceipt[]) {
    return receipts.filter(r => minorPence(r.unallocated_pence) > 0 && r.dedupe_status !== 'duplicate' && !r.active_transfer_id && !r.active_refund_id && r.classification !== 'Personal').map(receipt => ({ receipt, kind: receipt.dedupe_status !== 'clear' ? 'identity' : receipt.classification === 'Transfer' ? 'transfer' : receipt.classification === 'Refund' ? 'refund' : canMatchReceipt(receipt) ? 'unmatched' : 'classification' })).sort((a, b) => minorPence(b.receipt.unallocated_pence) - minorPence(a.receipt.unallocated_pence) || a.receipt.transaction_date.localeCompare(b.receipt.transaction_date) || a.receipt.id.localeCompare(b.receipt.id));
}
