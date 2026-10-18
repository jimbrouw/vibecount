import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllExportRows } from './export-pages';
import { readFinancialStamp, readConsistentReconciliation } from './consistent-reconciliation';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { currencyCode, currencyMinor } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { readBankChoiceContext, finishBankChoiceContext } from './native-choice-store';
import { nativeBankChoice, bankChoiceIndex } from './native-choice';
import type { MatchReceipt, MatchInvoice } from './match-proposals';
type Client = {
    id: string;
    name: string;
    updated_at: string;
};
export type MatchAllocation = {
    id: string;
    invoice_id: string;
    amount_pence: string | number;
    invoice_number: string | null;
};
type ReceiptRow = MatchReceipt;
type InvoiceRow = Omit<MatchInvoice, 'client_name'>;
/** Complete candidate scope, independent of the page displayed to the human. */
export async function loadMatchData(db: Pick<SupabaseClient, 'from' | 'rpc'>, owner: string, year: number, selection?: {
    receipt: string;
    after: string | null;
}) {
    if (!owner || !Number.isInteger(year) || year < 2000 || year > 2100)
        throw new Error('Choose the owner and tax year.');
    async function rows<T extends {
        id: string;
    }>(table: string, columns: string, receiptYear = false, settlementKind?: 'native_gbp' | 'fx_gbp_cash') { return readAllExportRows<T>(async (after) => { let q = db.from(table).select(columns).eq('user_id', owner).order('id').limit(500); if (receiptYear)
        q = q.gte('transaction_date', `${year}-04-06`).lt('transaction_date', `${year + 1}-04-06`); if (table === 'invoice_payment_balances')
        q = q.eq('status', 'finalised'); if (settlementKind) q = q.eq('settlement_kind', settlementKind); if (table === 'active_dimensioned_invoice_allocations' && selection) {
        q = q.eq('transaction_id', selection.receipt);
        if (selection.after && settlementKind === 'native_gbp')
            q = q.gt('id', selection.after);
    } if (after)
        q = q.gt('id', after); const r = await q; return { data: r.data as T[] | null, error: r.error }; }); }
    return readConsistentReconciliation(() => readFinancialStamp(() => db.rpc('reconciliation_export_stamp')), async () => {
        const bankContext = await readBankChoiceContext(db, owner);
        const clients = await rows<Client>('clients', 'id,name,updated_at');
        const [receipts, invoices, allocations, fx] = await Promise.all([rows<ReceiptRow>('receipt_allocation_balances', 'id,import_id,transaction_date,description,reference,signed_amount_pence,allocated_pence,unallocated_pence,decision_version,classification,business_use_bps,dedupe_status,record_status,recognized_pence,currency,active_transfer_id,active_refund_id,refunded_pence,record_type', true), rows<InvoiceRow>('invoice_payment_balances', 'id,number,invoice_date,client_id,invoice_pence,allocated_pence,outstanding_pence,updated_at,currency,status,credited_pence,entitlement_pence,refund_due_pence,returned_pence,retained_cash_pence'), selection ? rows<MatchAllocation>('active_dimensioned_invoice_allocations', 'id,invoice_id,amount_pence,invoice_number:invoice_snapshot->>number', false, 'native_gbp') : Promise.resolve([]), selection ? rows<{id:string;invoice_id:string;conversion_lot_id:string;invoice_minor:number;invoice_currency:string;amount_pence:number}>('active_dimensioned_invoice_allocations', 'id,invoice_id,conversion_lot_id,invoice_minor,invoice_currency,amount_pence', false, 'fx_gbp_cash') : Promise.resolve([])]);
        if (JSON.stringify(clients) !== JSON.stringify(await rows<Client>('clients', 'id,name,updated_at')))
            throw new Error('Client identity changed during matching review.');
        const names = new Map(clients.map(c => [c.id, redactBankDetailsForPrompt(c.name)]));
        const fx_allocations = fx.map(a => { const original=currencyMinor(a.invoice_minor),cash=currencyMinor(a.amount_pence);if(original<=0||cash<0)throw new Error('Complete dimensioned FX relationship unavailable.');return {id:fxEvidenceId(a.id),invoice_id:fxEvidenceId(a.invoice_id),conversion_lot_id:fxEvidenceId(a.conversion_lot_id),invoice_minor:original,invoice_currency:currencyCode(a.invoice_currency),amount_pence:cash}; });
        const bank_coverage = await finishBankChoiceContext(db, owner, bankContext);
        const sourceIndex=bankChoiceIndex(bank_coverage);
        const receiptIds=new Set(receipts.map(r=>r.id));
        if(bank_coverage.observations.some(r=>r.tax_year_start===year&&r.representation==='native_gbp'&&Number(r.signed_amount_pence)>0&&!receiptIds.has(r.id)))throw new Error('Complete native receipt coverage is missing a source.');
        if(selection && !bank_coverage.observations.some(r=>r.id===selection.receipt))throw new Error('Selected bank source is unavailable.');
        return { bank_coverage, allocations, fx_allocations, receipts: receipts.filter(r=>nativeBankChoice(sourceIndex,r)).map(r => ({ ...r, description: redactBankDetailsForPrompt(r.description), reference: redactBankDetailsForPrompt(r.reference) })), invoices: invoices.map(i => ({ ...i, client_name: names.get(i.client_id) ?? '' })) };
    });
}
