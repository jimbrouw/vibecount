import Link from 'next/link';
import type { FilingPackInput } from '@/lib/tax/filing-pack';
import { parseFxProvenance } from '@/lib/fx/provenance';

export default function FilingFxProvenance({input}:{input:FilingPackInput}){
  if(input.schema_version!=='filing-pack-input/3'&&input.schema_version!=='filing-pack-input/4'&&input.schema_version!=='filing-pack-input/5'&&input.schema_version!=='filing-pack-input/6')return null;
  const fx=parseFxProvenance(input.owner_id,input.fx_provenance,input.observations);
  return <section data-testid="filing-fx-provenance" className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">Retained currency relationship evidence</h2>
    <p>{fx.counts.lots} retained conversion lots; {fx.counts.events} allocation and reversal events, including zero-cash portions. These are source context, not additional tax-year income or a GBP valuation of an invoice. Unsupported currency tax treatment remains unresolved.</p>
    <ul>{fx.lots.map(l=><li key={l.id}><Link data-testid={'filing-fx-lot-'+l.id} href={'/dashboard/reconciliation/fx?receipt='+l.receipt_id}>Inspect retained lot {l.id}</Link> — {l.event_count} history events; {l.active_count} active portions. Invoice source SHA-256 {l.invoice_fact.source_snapshot.document_source.document.file_sha256}; conversion source SHA-256 {l.conversion_fact.source_snapshot.document_source.document.file_sha256}.</li>)}</ul>
    <p>Retained hashes identify the captured evidence. They do not assert current access to the original files. The draft exports preserve the complete scoped history.</p>
  </section>;
}
