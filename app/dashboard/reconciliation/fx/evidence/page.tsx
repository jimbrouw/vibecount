import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { fxEvidenceId, parseFxEvidenceHistory } from '@/lib/fx/document-facts';
import { readFxEvidenceCatalog } from '@/lib/fx/document-facts-store';
import FxEvidenceReview from './FxEvidenceReview';
import EvidenceDetails from './EvidenceDetails';
import RetainedSourceCheck from './RetainedSourceCheck';
import { parseSourceReadCheck, type SourceReadCheck } from '@/lib/fx/retained-source';
const target='/dashboard/reconciliation/fx/evidence';
export default async function FxEvidencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
    const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');
    const p=await searchParams;let catalog=null,history=null,checks:SourceReadCheck[]|null=null,after:string|undefined,checkAfter:string|undefined,initialFamily:string|undefined;
    try{
        if(p.after!==undefined)after=fxEvidenceId(p.after);
        if(p.family!==undefined)initialFamily=fxEvidenceId(p.family);
        if(p.checkAfter!==undefined)checkAfter=fxEvidenceId(p.checkAfter);
        catalog=await readFxEvidenceCatalog(db,user.id);
        if(initialFamily&&!catalog.facts.some(f=>f.family_id===initialFamily))throw new Error();
        let q=db.from('fx_document_fact_revisions').select('id,user_id,family_id,kind,ordinal,state,ruleset_id,document_id,invoice_evidence_revision_id,transaction_id,transaction_version,data,source_snapshot,human_read_original,created_at,author,rationale').eq('user_id',user.id).order('id').limit(21);
        if(after)q=q.gt('id',after);
        const result=await q;if(result.error)throw new Error();history=parseFxEvidenceHistory(user.id,result.data);
        let checkQuery=db.from('invoice_source_read_checks').select('id,user_id,request_id,intent,fact_revision_id,document_id,source_snapshot,outcome,author,checked_at').eq('user_id',user.id).order('id').limit(21);
        if(checkAfter)checkQuery=checkQuery.gt('id',checkAfter);
        const checked=await checkQuery;if(checked.error||!Array.isArray(checked.data)||checked.data.length>21)throw new Error();
        checks=checked.data.map(r=>parseSourceReadCheck(user.id,r));
        if(new Set(checks.map(r=>r.id)).size!==checks.length)throw new Error();
        const finalStamp=await db.rpc('fx_evidence_review_stamp');
        if(finalStamp.error||finalStamp.data!==catalog.stamp)throw new Error();
    }catch{catalog=null;history=null;checks=null;}
    return <main className="mx-auto max-w-5xl space-y-6 p-5">
        <header className="space-y-2"><h1 className="text-2xl font-semibold">Review FX document evidence</h1><p>Prepare facts from an invoice or documented conversion to GBP. Every decision needs human review. This prepares evidence; it does not create an invoice, settle it or approve income.</p>
            <nav aria-label="Evidence review links" className="flex flex-wrap gap-4"><Link href="/dashboard/imports" data-testid="fx-evidence-imports" className="underline">Preserve or review source documents</Link><Link href="/dashboard/reconciliation" data-testid="fx-evidence-reconciliation" className="underline">Invoice reconciliation</Link></nav>
            <Link href="/dashboard/reconciliation/fx/invoices" data-testid="fx-evidence-canonical-invoices" className="underline">Review canonical external invoice capture</Link>
        </header>
        {typeof p.error==='string'&&<p role="alert" data-testid="fx-evidence-server-error">Evidence review could not be saved. Reload the current sources, check the original copy and review again. Existing decisions remain in history.</p>}
        {p.result==='saved'&&<p role="status" data-testid="fx-evidence-saved">Evidence decision saved or its exact prior result recovered. Review the latest state below; recovering an old request does not restore its approval.</p>}
        {p.sourceCheck==='verified'&&<p role="status" data-testid="invoice-source-check-saved">A retained-copy check succeeded or its exact past result was recovered. Check the recorded time below; this does not establish current availability or approve an invoice.</p>}
        {typeof p.sourceCheck==='string'&&p.sourceCheck!=='verified'&&<p role="alert" data-testid="invoice-source-check-error">The retained copy could not be verified. Review check history and restore the exact object/key if needed; no invoice or financial effect was created.</p>}
        {!catalog||!history||!checks?<p role="alert" data-testid="fx-evidence-unavailable">Complete owned evidence and revision history are unavailable. Reload before reviewing.</p>:<>
            <p>Verified means a human attested to reading an original. Source availability is checked separately. Latest provisional or withdrawn revisions replace earlier eligibility. Fees, foreign receipts and financial FX settlement need separate supported workflows.</p>
            <FxEvidenceReview catalog={catalog} familyId={randomUUID()} requestId={randomUUID()} initialFamily={initialFamily}/>
            <RetainedSourceCheck catalog={catalog} requestId={randomUUID()}/>
            <section aria-labelledby="invoice-source-check-history-heading" className="space-y-2"><h2 id="invoice-source-check-history-heading" className="text-xl font-semibold">Past retained-copy checks</h2><p>These are point-in-time byte-read checks, separate from human fact review and current source eligibility. A successful check is not permanent access or canonical invoice approval.</p>
                {!checks.length&&<p>No stored-copy checks on this page.</p>}
                {checks.slice(0,20).map(r=><p key={r.id} data-testid={`invoice-source-check-history-${r.id}`}>{r.checked_at} · {r.outcome==='verified'?'Retained bytes verified then':'Retained bytes unavailable'} · invoice evidence {r.fact_revision_id} · {r.intent.reason}</p>)}
                {checks.length>20&&<Link className="underline" data-testid="invoice-source-check-history-next" href={target+'?checkAfter='+checks[19].id}>More past retained-copy checks</Link>}
            </section>
            <section className="space-y-3" aria-labelledby="fx-evidence-latest-heading"><h2 id="fx-evidence-latest-heading" className="text-xl font-semibold">Latest evidence states</h2>
                {!catalog.facts.length&&<p>No evidence fact families yet.</p>}
                {catalog.facts.map(f=><p key={f.id} data-testid={`fx-evidence-latest-${f.family_id}`}><Link data-testid={`fx-evidence-family-link-${f.family_id}`} className="underline" href={target+'?family='+f.family_id}>{f.kind} family {f.family_id}</Link> · revision {f.ordinal} · {f.state} · {f.source_current?'source current':'source stale'} · {f.usable?'eligible as evidence':'unavailable as current verified evidence'}</p>)}
            </section>
            <section className="space-y-3" aria-labelledby="fx-evidence-history-heading"><h2 id="fx-evidence-history-heading" className="text-xl font-semibold">Immutable evidence revision history</h2><p>Historical snapshots retain the facts and source state recorded then. Current source eligibility is shown separately above.</p>
                {!history.length&&<p>No revisions on this page.</p>}
                {history.slice(0,20).map(f=><details key={f.id} className="space-y-2 rounded border p-3" data-testid={`fx-evidence-history-${f.id}`}><summary data-testid={`fx-evidence-history-toggle-${f.id}`}>{f.created_at} · {f.kind} · revision {f.ordinal} · {f.state}</summary>
                    <p>Revision {f.id} · family {f.family_id} · author {f.author}. Human original-read attestation: {f.human_read_original?'yes':'no'}. Reason: {f.rationale}</p>
                    <EvidenceDetails source={f.source_snapshot.document_source} data={f.data} parent={f.source_snapshot.invoice_evidence} receipt={f.source_snapshot.receipt}/>
                </details>)}
                <nav aria-label="Evidence history pages" className="flex gap-4">{after&&<Link href={target} data-testid="fx-evidence-history-first" className="underline">First revision page</Link>}{history.length>20&&<Link href={target+'?after='+history[19].id} data-testid="fx-evidence-history-next" className="underline">More revisions</Link>}</nav>
            </section>
        </>}
    </main>;
}
