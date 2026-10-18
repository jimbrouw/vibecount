import Link from 'next/link';
import { fxAmountReadback } from '@/lib/fx/readback';
import type { FxDependencies } from '@/lib/fx/dependencies';
export default function FxDependencyBlockers({ review: r, prefix, operation, selectedImportId }: {
  review: Pick<FxDependencies, 'fx_blockers'>; prefix: string; operation: string; selectedImportId?: string;
}) {
  return <section role="alert" data-testid={`${prefix}-fx-blocked`} className="space-y-4 rounded border p-4">
    <h2 className="text-xl font-semibold">Review linked FX matches first</h2>
    <p>{r.fx_blockers.length} conversion lots link to the affected sources. {operation} is blocked. Its accounting changes and confirmation are withheld until these FX relationships are reversed.</p>
    <ul className="space-y-4">{r.fx_blockers.map(l => <li key={l.id} data-testid={`${prefix}-fx-lot-${l.id}`} className="space-y-1">
      <p>Retained original: {fxAmountReadback(l.original_minor, l.invoice_currency)}. Matched cash: {fxAmountReadback(l.cash_pence, 'GBP')}. {l.active_count} active portions; history version {l.version}. Zero-cash portions also block this action.</p>
      <Link data-testid={`${prefix}-fx-review-${l.id}`} className="block underline" href={`/dashboard/reconciliation/fx/reversal?lot=${l.id}`}>Review complete conversion-lot reversal</Link>
      <Link data-testid={`${prefix}-fx-source-${l.id}`} className="block underline" href={`/dashboard/imports?import=${l.import_id}&transaction=${l.receipt_id}#transaction-${l.receipt_id}`}>Review {selectedImportId ? l.import_id === selectedImportId ? 'selected import' : 'connected import' : 'linked'} source</Link>
    </li>)}</ul>
    <p>Complete FX reversal requires a saved review and separate human financial confirmation. Return and reload this review after those relationships are reversed. {operation} remains unavailable while they are active. Original files and financial history remain preserved.</p>
  </section>;
}
