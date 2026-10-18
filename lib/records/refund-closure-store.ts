import { refundReversalClosure, type RefundClosureCatalog, type RefundClosureScope } from './refund-closure';
import { dependencyObject, parseFxDependencies, requireDependencySources } from '../fx/dependencies';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
/** Authenticated owner is supplied by the server; callers must not substitute submitted graph JSON. */
export async function readRefundReversalClosure(db: Client, owner: string, scope: RefundClosureScope) {
    const r = await db.rpc('read_refund_reversal_graph', { p_kind: scope.kind, p_id: scope.id });
    if (r.error || !r.data || r.data.owner_id !== owner) throw new Error('Complete owned refund graph unavailable.');
    return refundReversalClosure(owner, scope, r.data as RefundClosureCatalog);
}
export async function readRefundReversalDependencies(db: Client, owner: string, scope: RefundClosureScope) {
    const r = await db.rpc('read_refund_reversal_graph_v2', { p_kind: scope.kind, p_id: scope.id });
    if (r.error) throw new Error('Complete owned refund dependencies unavailable.');
    const p = dependencyObject(r.data);
    if (p.schema_version !== 'refund-reversal-context/2' || p.kind !== scope.kind || p.id !== scope.id || new TextEncoder().encode(JSON.stringify(p)).length > 2000000) throw new Error('Selected refund dependency scope changed.');
    const dependencies = parseFxDependencies(owner, p.dependencies);
    if (scope.kind !== 'import' && !dependencies.sources.some(s => s.id === scope.id)) throw new Error('Selected refund source unavailable.');
    if (dependencies.blocked) {
        if (p.native_context !== null) throw new Error('Blocked financial totals must be withheld.');
        return { dependencies, native_review: null };
    }
    const native = dependencyObject(p.native_context);
    if (!Array.isArray(native.transactions)) throw new Error('Complete native graph unavailable.');
    requireDependencySources(dependencies, native.transactions as RefundClosureCatalog['transactions'], String(native.stamp));
    return { dependencies, native_review: refundReversalClosure(owner, scope, native as RefundClosureCatalog) };
}
