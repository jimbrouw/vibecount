'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type FxEvidenceCatalog, type FxInvoiceDocumentData } from '@/lib/fx/document-facts';
import { fxAmountReadback } from '@/lib/fx/readback';
import { checkInvoiceRetainedSource } from './source-actions';
function Submit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return <button data-testid="invoice-source-check-submit" disabled={!enabled || pending} className="rounded border p-3">{pending ? 'Checking retained copy…' : 'Check retained invoice copy'}</button>;
}
export default function RetainedSourceCheck({ catalog, requestId }: { catalog: FxEvidenceCatalog; requestId: string }) {
  return <Check key={catalog.stamp + requestId} catalog={catalog} requestId={requestId} />;
}
function Check({ catalog, requestId }: { catalog: FxEvidenceCatalog; requestId: string }) {
  const [factId, setFact] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const fact = catalog.facts.find(f => f.id === factId && f.kind === 'invoice' && f.usable);
  const data = fact?.data as FxInvoiceDocumentData | undefined;
  return <section aria-labelledby="invoice-source-check-heading" className="space-y-3">
    <h2 id="invoice-source-check-heading" className="text-xl font-semibold">Check the retained invoice copy</h2>
    <p>This privately checks whether the server can decrypt the stored copy and match its exact hash, size and file signature. It creates no invoice, income, payment or settlement. It does not replace your original-document review.</p>
    <form action={checkInvoiceRetainedSource} data-testid="invoice-source-check-form" className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block">Verified invoice evidence<select name="factId" required data-testid="invoice-source-check-fact" className="block w-full rounded border p-2" value={factId} onChange={e => { setFact(e.target.value); setConfirmed(false); }}><option value="">Choose current verified invoice evidence</option>{catalog.facts.filter(f => f.kind === 'invoice' && f.usable).map(f => <option key={f.id} value={f.id}>Invoice fact revision {f.ordinal} · {f.id}</option>)}</select></label>
      {fact && data && <div data-testid="invoice-source-check-readback" className="rounded border p-3"><p>Original document: {fxAmountReadback(data.original_total_minor, data.currency)} · invoice date {data.invoice_date}</p><p>Evidence revision {fact.ordinal} · document {fact.document_id}</p><p>Stored SHA-256: {fact.source_snapshot.document_source.document.file_sha256}</p><p>Original document units are not cash or a GBP valuation.</p></div>}
      <label className="block">Reason for this check<input name="reason" required maxLength={1000} data-testid="invoice-source-check-reason" className="block w-full rounded border p-2" value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></label>
      <label className="flex gap-2"><input name="humanConfirmed" type="checkbox" value="yes" checked={confirmed} disabled={!fact || !reason.trim()} data-testid="invoice-source-check-confirm" onChange={e => setConfirmed(e.target.checked)} />I reviewed the selected evidence and want a private stored-copy check. This does not approve a financial action.</label>
      <Submit enabled={!!fact && !!reason.trim() && confirmed} />
    </form>
  </section>;
}
