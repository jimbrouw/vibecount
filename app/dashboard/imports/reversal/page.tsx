import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readCurrentImportReversal } from '@/lib/records/native-connected-store';
import NativeSourceScope from '../../NativeSourceScope';
import ImportReversalReview from './ImportReversalReview';
import { readForeignImportReversal } from '@/lib/records/foreign-import-reversal';
import ForeignImportReversalReview from './ForeignImportReversalReview';
import FxDependencyBlockers from '../../reconciliation/FxDependencyBlockers';
export default async function ImportReversalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const p = await searchParams, source = p.import; let review = null; let foreignReview = null;
    if (typeof source === 'string') { try { review = await readCurrentImportReversal(db, user.id, source); } catch { /* No partial source scope is displayed. */ } }
    if (typeof source === 'string' && (!review || review.source_context.blocked)) { try { foreignReview = await readForeignImportReversal(db,user.id,source); } catch { /* Preserve native blocked/error scope. */ } }
    return <main className="mx-auto max-w-5xl space-y-5 p-5"><header><h1 className="text-2xl font-semibold">Review complete import reversal</h1>
        <p>Review every accounting effect and connected refund, transfer and invoice match before excluding this import.</p>
        <Link data-testid="import-reversal-back" className="underline" href="/dashboard/imports">Back to imports</Link></header>
        {typeof p.error === 'string' && <p role="alert">{p.error.slice(0, 300)}</p>}
        {foreignReview ? <ForeignImportReversalReview review={foreignReview} requestId={randomUUID()}/> : review ? <><NativeSourceScope context={review.source_context} prefix="import-reversal" operationCount={review.operation_source_ids.length}/>{review.dependencies.blocked&&<FxDependencyBlockers review={review.dependencies} prefix="import-reversal" operation="Complete import reversal" selectedImportId={review.import_id}/>} {!review.blocked&&review.native_review&&<ImportReversalReview review={review.native_review} sourceStamp={review.source_context.source_stamp} requestId={randomUUID()} />}</> : <p role="alert" data-testid="import-reversal-unavailable">The complete owned import sources are unavailable. Return to imports and reload before reviewing.</p>}
    </main>;
}
