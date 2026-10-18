import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { readCurrentRefundSplit } from '@/lib/records/native-connected-store';
import NativeSourceScope from '../../../NativeSourceScope';
import FxDependencyBlockers from '../../FxDependencyBlockers';
import RefundSplitReview from './RefundSplitReview';

export default async function RefundSplitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const p = await searchParams, refund = p.refund;
    let catalog = null;
    if (typeof refund === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(refund)) {
        try { catalog = await readCurrentRefundSplit(db, user.id, refund); } catch { /* Withhold incomplete or foreign catalogs. */ }
    }
    return <main className="mx-auto max-w-5xl space-y-5 p-5"><header><h1 className="text-2xl font-semibold">Allocate recorded refund cash</h1>
        <p>Choose the original payments and allocate the entire refund. Review every accounting reduction before approval.</p>
        <Link data-testid="refund-split-back" className="underline" href="/dashboard/reconciliation/refunds">Back to customer and supplier refunds</Link></header>
        {typeof p.error === 'string' && <p role="alert">{p.error.slice(0, 300)}</p>}
        {catalog && typeof refund === 'string' ? <><NativeSourceScope context={catalog.source_context} prefix="refund-split" selectedIds={[refund.toLowerCase()]}/>{catalog.blocked&&catalog.dependencies.blocked&&<FxDependencyBlockers review={catalog.dependencies} prefix="refund-split" operation="Refund allocation"/>}{!catalog.blocked&&catalog.native_catalog&&<RefundSplitReview catalog={catalog.native_catalog} sourceStamp={catalog.source_context.source_stamp} refundId={refund.toLowerCase()} requestId={randomUUID()} />}</>
            : <p role="alert" data-testid="refund-split-unavailable">The complete owned refund sources are unavailable. Return to refunds and reload before reviewing.</p>}
    </main>;
}
