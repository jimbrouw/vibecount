'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { parseFxEvidenceCatalog } from '@/lib/fx/document-facts';
import { externalInvoiceReadback, type ExternalInvoiceContext } from '@/lib/invoices/external';
import { fxAmountReadback } from '@/lib/fx/readback';
import { captureExternalInvoice } from './actions';
function Submit({ enabled }: { enabled: boolean }) { const { pending } = useFormStatus(); return <button data-testid="external-invoice-submit" disabled={!enabled || pending} className="rounded border p-3">{pending ? 'Verifying and saving…' : 'Save reviewed external document'}</button>; }
export default function ExternalInvoiceReview(props: { context: ExternalInvoiceContext; invoiceId: string; requestId: string }) { return <Review key={props.context.stamp + props.requestId} {...props} />; }
function Review({ context, invoiceId, requestId }: { context: ExternalInvoiceContext; invoiceId: string; requestId: string }) {
  const [factId, setFact] = useState(''), [clientId, setClient] = useState(''), [reason, setReason] = useState(''), [read, setRead] = useState(false), [confirmed, setConfirmed] = useState(false);
  const catalog = parseFxEvidenceCatalog(context.owner, context.evidence), fact = catalog.facts.find(f => f.id === factId), previous = context.invoices.find(i => i.source_fact_family_id === fact?.family_id);
  const reset = () => { setRead(false); setConfirmed(false); };
  let preview = null;
  try { preview = externalInvoiceReadback(context.owner, { schema_version: 'external-invoice-intent/1', request_id: requestId, invoice_id: previous?.id ?? invoiceId, client_id: clientId, source_fact_revision_id: factId, source_fact_family_id: fact?.family_id, expected_revision: previous?.external_revision ?? 0, expected_updated_at: previous?.updated_at ?? null, expected_stamp: context.stamp, original_sha256: fact?.source_snapshot.document_source.document.file_sha256, human_read_original: true, reason }, context); } catch { /* Incomplete selection has no save/read-back authority. */ }
  return <form action={captureExternalInvoice} data-testid="external-invoice-form" className="space-y-4">
    <input type="hidden" name="intent" value={preview ? JSON.stringify({ ...preview.intent, human_read_original: read }) : ''} />
    <label className="block">Current verified invoice evidence<select data-testid="external-invoice-fact" className="block w-full rounded border p-2" value={factId} onChange={e => { setFact(e.target.value); reset(); }} required><option value="">Choose an invoice fact</option>{catalog.facts.filter(f => f.kind === 'invoice' && f.usable).map(f => <option key={f.id} value={f.id}>Evidence revision {f.ordinal} · {f.id}</option>)}</select></label>
    <label className="block">Client<select data-testid="external-invoice-client" className="block w-full rounded border p-2" value={clientId} onChange={e => { setClient(e.target.value); reset(); }} required><option value="">Choose the reviewed client</option>{context.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="block">Reason<input data-testid="external-invoice-reason" className="block w-full rounded border p-2" value={reason} maxLength={1000} onChange={e => { setReason(e.target.value); reset(); }} required /></label>
    {preview && <div data-testid="external-invoice-readback" className="space-y-2 rounded border p-3"><p>{previous ? `Correct canonical revision ${previous.external_revision} to ${preview.next_revision}.` : 'Create one preserved external invoice.'}</p>{previous && <p>Previous original: {fxAmountReadback(previous.original_total_minor, previous.currency)} · {previous.invoice_date}.</p>}<p>Reviewed original: {fxAmountReadback(preview.original.original_total_minor, preview.original.currency)} · {preview.original.invoice_date} · reference {preview.original.invoice_reference}.</p><p>Client: {preview.client.name}. Evidence family {preview.fact.family_id}, revision {preview.fact.ordinal}.</p><p>Original SHA-256: {preview.intent.original_sha256}</p><p>This captures document facts only. It adds no cash, GBP valuation, income, expense or settlement. A fresh private retained-copy check must succeed before save. Tax/finance coverage remains unresolved for unsupported external documents.</p></div>}
    {!preview && <p data-testid="external-invoice-incomplete">Choose a current verified successor, owned client and review reason. An already captured source cannot be saved again as a new invoice.</p>}
    <label className="flex gap-2"><input data-testid="external-invoice-original-read" type="checkbox" checked={read} disabled={!preview} onChange={e => { setRead(e.target.checked); setConfirmed(false); }} />I read this exact original copy and checked its currency, amount, date, reference and client.</label>
    <label className="flex gap-2"><input data-testid="external-invoice-confirm" name="humanConfirmed" value="yes" type="checkbox" checked={confirmed} disabled={!preview || !read} onChange={e => setConfirmed(e.target.checked)} />I confirm the document read-back. No financial posting or settlement is approved.</label>
    <Submit enabled={!!preview && read && confirmed} />
  </form>;
}
