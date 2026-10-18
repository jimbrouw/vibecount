import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { fxEvidenceId, parseFxEvidenceCatalog } from '@/lib/fx/document-facts';
import { readExternalInvoiceContext, readExternalInvoiceStamp, parseExternalHistory } from '@/lib/invoices/external-store';
import { fxAmountReadback } from '@/lib/fx/readback';
import ExternalInvoiceReview from './ExternalInvoiceReview';
import ExternalClientReview from './ExternalClientReview';
const target = '/dashboard/reconciliation/fx/invoices';
export default async function ExternalInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = await createClient(), { data: { user }, error } = await db.auth.getUser(); if (error || !user) redirect('/login');
  const p = await searchParams; let context = null, history = null;
  try {
    context = await readExternalInvoiceContext(db, user.id);
    let q = db.from('invoice_revisions').select('id,user_id,invoice_id,version,snapshot,origin,source_fact_revision_id,source_read_check_id,created_at,author').eq('user_id', user.id).eq('origin', 'preserved_external').order('id').limit(21);
    if (p.after !== undefined) q = q.gt('id', fxEvidenceId(p.after));
    const r = await q; if (r.error) throw new Error(); history = parseExternalHistory(user.id, r.data);
    if (await readExternalInvoiceStamp(db) !== context.stamp) throw new Error();
  } catch { context = null; history = null; }
  const facts = context ? parseFxEvidenceCatalog(user.id, context.evidence).facts : [];
  return <main className="mx-auto max-w-5xl space-y-6 p-5"><h1 className="text-2xl font-semibold">Review preserved external invoices</h1><p>Keep the original document currency and evidence history. Capture and corrections require human review. Payments, FX valuation, settlement, credits, native PDFs and delivery remain unavailable here.</p>
    <Link data-testid="external-invoice-evidence-link" href="/dashboard/reconciliation/fx/evidence" className="underline">Review original evidence and retained-copy checks</Link>
    {p.error && <p role="alert" data-testid="external-invoice-error">The reviewed change could not be saved. Reload current sources and check history before reviewing again. For a client label, check whether it already exists and omit bank details.</p>}
    {p.client === 'saved' && <p role="status" data-testid="external-client-saved">Client label saved or its unchanged prior request recovered. Select it in the separate invoice review.</p>}
    {p.result === 'saved' && <p role="status" data-testid="external-invoice-saved">Document captured or its exact historical result recovered. Recovery does not restore old source eligibility or approve a payment.</p>}
    {!context || !history ? <p role="alert" data-testid="external-invoice-unavailable">Complete owned invoice review context/history is unavailable.</p> : <>
      <ExternalInvoiceReview context={context} invoiceId={randomUUID()} requestId={randomUUID()} />
      <ExternalClientReview clientId={randomUUID()} />
      <section aria-labelledby="external-invoice-heads"><h2 id="external-invoice-heads" className="text-xl font-semibold">Captured documents</h2>{context.invoices.map(i => <p key={i.id} data-testid={`external-invoice-current-${i.id}`}>{fxAmountReadback(i.original_total_minor, i.currency)} · {i.invoice_date} · canonical revision {i.external_revision} · {facts.some(f => f.id === i.source_fact_revision_id && f.usable) ? 'captured source is current verified evidence' : 'captured source is no longer current verified evidence; history is preserved'}. Settlement and GBP valuation unavailable.</p>)}</section>
      <section aria-labelledby="external-invoice-history"><h2 id="external-invoice-history" className="text-xl font-semibold">Immutable sourced revision history</h2>{history.slice(0,20).map(r => <p key={r.id} data-testid={`external-invoice-history-${r.id}`}>{r.created_at} · original {fxAmountReadback(r.original_total_minor, r.currency)} · {r.invoice_date} · revision {r.version} · evidence {r.source_fact_revision_id} · retained-copy check {r.source_read_check_id}. Historical document facts, not current source availability or cash.</p>)}{history.length > 20 && <Link data-testid="external-invoice-history-next" href={target + '?after=' + history[19].id} className="underline">More sourced revisions</Link>}</section>
    </>}
  </main>;
}
