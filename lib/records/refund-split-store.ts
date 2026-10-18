import { minorPence } from './allocations';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import type { RefundSplitCatalog, SplitRefundChoice } from './refund-splits';
import { dependencyObject, parseFxDependencies, requireDependencySources } from '../fx/dependencies';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function id(value: unknown): string {
    if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Source identity unavailable.');
    return value.toLowerCase();
}
const nullableId = (v: unknown) => v === null ? null : id(v);
function integer(v: unknown, min: number, max: number): number {
    if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !/^-?\d+$/.test(v))) throw new Error('Source amount unavailable.');
    const n = minorPence(v); if (n < min || n > max) throw new Error('Source value unavailable.'); return n;
}
function enumeration<T extends string>(v: unknown, allowed: readonly T[]): T {
    if (typeof v !== 'string' || !allowed.includes(v as T)) throw new Error('Source state unavailable.'); return v as T;
}
function boolean(v: unknown): boolean { if (typeof v !== 'boolean') throw new Error('Source validity unavailable.'); return v; }
function label(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') throw new Error('Source label unavailable.');
    return redactBankDetailsForPrompt(v).slice(0, 160);
}
/** Rebuild only safe metadata, even if a transport unexpectedly adds private fields. */
export function refundSplitCatalog(raw: unknown, owner: string, refund: string): RefundSplitCatalog {
    if (!raw || typeof raw !== 'object') throw new Error('Complete owned refund catalog unavailable.');
    const r = raw as Record<string, unknown>;
    if (id(r.owner_id) !== id(owner) || typeof r.stamp !== 'string' || !/^[a-f0-9]{32}$/.test(r.stamp) || !Array.isArray(r.transactions) || r.transactions.length > 10000) throw new Error('Complete owned refund catalog unavailable.');
    const transactions: SplitRefundChoice[] = r.transactions.map(value => {
        if (!value || typeof value !== 'object') throw new Error('Source metadata unavailable.');
        const t = value as Record<string, unknown>;
        if (id(t.user_id) !== id(owner)) throw new Error('Foreign source unavailable.');
        const date = String(t.transaction_date), parsed = Date.parse(date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date || date < '1900-01-01' || date > '9998-12-31') throw new Error('Source date unavailable.');
        if (typeof t.refund_stamp !== 'string' || !/^[a-f0-9]{32}$/.test(t.refund_stamp)) throw new Error('Source history unavailable.');
        if (t.effect_sign !== null && t.effect_sign !== 1 && t.effect_sign !== -1) throw new Error('Source effect unavailable.');
        return {
            id: id(t.id), user_id: id(owner), account_id: id(t.account_id), import_id: id(t.import_id), source_row_id: id(t.source_row_id),
            recognized_record_id: nullableId(t.recognized_record_id), record_transaction_id: nullableId(t.record_transaction_id), project_id: nullableId(t.project_id),
            category_label: label(t.category_label), project_label: label(t.project_label),
            category_valid: boolean(t.category_valid), record_provenance_valid: boolean(t.record_provenance_valid),
            transaction_date: date, signed_amount_pence: integer(t.signed_amount_pence, -999999999999, 999999999999), currency: enumeration(t.currency, ['GBP']),
            description: '', account_label: 'Owned account', account_mask: '', account_type: enumeration(t.account_type, ['bank', 'credit_card']),
            classification: enumeration(t.classification, ['Business', 'Personal', 'Mixed', 'Transfer', 'Refund', 'Unknown']), decision_version: integer(t.decision_version, 0, 2147483647),
            dedupe_status: enumeration(t.dedupe_status, ['clear', 'needs_review', 'duplicate']), active_transfer_id: nullableId(t.active_transfer_id), active_refund_id: nullableId(t.active_refund_id), has_refunds: boolean(t.has_refunds),
            import_status: enumeration(t.import_status, ['review', 'committed', 'discarded']), record_status: t.record_status === null ? null : enumeration(t.record_status, ['draft', 'review', 'approved', 'excluded']),
            recognized_pence: integer(t.recognized_pence, -999999999999, 999999999999), invoice_allocated_pence: integer(t.invoice_allocated_pence, 0, 999999999999),
            business_use_bps: integer(t.business_use_bps, 0, 10000), record_type: t.record_type === null ? null : enumeration(t.record_type, ['income', 'expense'] as const),
            effect_sign: t.effect_sign === null ? null : integer(t.effect_sign, -1, 1), category_id: nullableId(t.category_id),
            refunded_pence: integer(t.refunded_pence, 0, 999999999999), reduced_pence: integer(t.reduced_pence, 0, 999999999999), refund_count: integer(t.refund_count, 0, 2147483647), refund_stamp: t.refund_stamp,
        };
    });
    if (new Set(transactions.map(t => t.id)).size !== transactions.length || !transactions.some(t => t.id === id(refund))) throw new Error('Complete refund source unavailable.');
    return { owner_id: id(owner), stamp: r.stamp, transactions };
}
export async function readRefundSplitCatalog(db: Client, owner: string, refund: string) {
    const r = await db.rpc('read_refund_split_catalog_v2', { p_refund: id(refund) });
    if (r.error) throw new Error('Complete owned refund catalog unavailable.');
    const p = dependencyObject(r.data);
    if (p.schema_version !== 'refund-split-catalog/2' || p.refund_id !== id(refund) || new TextEncoder().encode(JSON.stringify(p)).length > 2000000) throw new Error('Current complete refund catalog unavailable.');
    const catalog = refundSplitCatalog(p.native_context, owner, refund), dependencies = parseFxDependencies(owner, p.dependencies);
    requireDependencySources(dependencies, catalog.transactions, catalog.stamp);
    return { ...catalog, fx_dependencies: dependencies };
}
