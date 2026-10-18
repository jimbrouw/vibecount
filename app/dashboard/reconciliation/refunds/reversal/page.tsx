import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readCurrentRefundClosure } from '@/lib/records/native-connected-store';
import NativeSourceScope from '../../../NativeSourceScope';
import type { RefundClosureScope } from '@/lib/records/refund-closure';
import FxDependencyBlockers from '../../FxDependencyBlockers';
import RefundClosureReview from './RefundClosureReview';

export default async function RefundReversalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const p = await searchParams, id = p.id, kind = p.kind;
    let review = null;
    if (typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) && typeof kind === 'string' && ['original', 'refund', 'import'].includes(kind)) {
        try { review = await readCurrentRefundClosure(db, user.id, { kind: kind as RefundClosureScope['kind'], id }); } catch { /* Withhold incomplete or stale source graphs. */ }
    }
    return <main className="mx-auto max-w-5xl space-y-5 p-5"><header><h1 className="text-2xl font-semibold">Review refund reversal</h1>
        <p>Related originals and shared refund cash must be reviewed and reversed together to preserve cumulative penny rounding.</p>
        <Link data-testid="refund-closure-back" className="underline" href="/dashboard/reconciliation/refunds">Back to customer and supplier refunds</Link></header>
        {typeof p.error === 'string' && <p role="alert">{p.error.slice(0, 300)}</p>}
        {review ? <><NativeSourceScope context={review.source_context} prefix="refund-closure" selectedIds={[String(id)]}/>{review.dependencies.blocked&&<FxDependencyBlockers review={review.dependencies} prefix="refund-closure" operation="Complete refund reversal"/>}{!review.blocked&&review.native_review&&<RefundClosureReview review={review.native_review} sourceStamp={review.source_context.source_stamp} requestId={randomUUID()} />}</> : <p role="alert" data-testid="refund-closure-unavailable">The complete owned refund sources are unavailable. Return to refunds and reload before reviewing.</p>}
    </main>;
}
