import Link from 'next/link';
import { parseInvoiceCurrencyCoverage, INVOICE_COVERAGE_LIMITATION } from '@/lib/invoices/currency-coverage';
import { invoiceOriginalAmount } from '@/lib/invoices/reporting';
import { fxAggregateReadback } from '@/lib/fx/readback';

/** Read-only metadata. Amounts describe originals, never cash or a tax-year allocation. */
export default function InvoiceCurrencyCoverage({ value, owner, testIdPrefix = 'tax' }: { value: unknown; owner: string; testIdPrefix?: 'tax' | 'finance' }) {
  const coverage = parseInvoiceCurrencyCoverage(value, owner), examples = coverage.invoices.filter(i => i.representation !== 'native_gbp').slice(0, 10);
  return <section className="space-y-3 rounded border p-4" data-testid={testIdPrefix + '-invoice-currency-coverage'}>
    <h3 className="font-semibold">Invoice currency coverage</h3>
    <p>{INVOICE_COVERAGE_LIMITATION}</p>
    <dl><dt>Finalised invoices across all years</dt><dd data-testid={testIdPrefix + '-coverage-total'}>{coverage.invoice_count}</dd>
      <dt>Native GBP invoices with available balances</dt><dd>{coverage.native_invoice_count}</dd>
      <dt>External invoices needing settlement and valuation support</dt><dd data-testid={testIdPrefix + '-coverage-external'}>{coverage.unsupported_external_invoice_count}</dd>
      <dt>Invalid or unavailable invoice representations</dt><dd data-testid={testIdPrefix + '-coverage-invalid'}>{coverage.invalid_invoice_count}</dd>
      <dt>Draft invoices, separate from finalised documents</dt><dd>{coverage.draft_invoice_count}</dd></dl>
    {examples.length > 0 && <><p>Examples: {examples.length} of {coverage.unsupported_external_invoice_count + coverage.invalid_invoice_count} unresolved invoice representations. Original amounts below are not GBP receipts.</p>
      <ul>{examples.map(row => {
        const amount = row.representation === 'invalid' ? null : invoiceOriginalAmount(row);
        return <li key={row.id}>{row.invoice_date} — {amount ? fxAggregateReadback(amount.minor, amount.currency) : 'Original units unavailable; review required'} — {row.id}</li>;
      })}</ul><Link data-testid={testIdPrefix + '-coverage-evidence-link'} href="/dashboard/reconciliation/fx/evidence">Review preserved invoice evidence</Link></>}
    <p>Coverage version {coverage.schema_version}; source token {coverage.stamp}. This does not certify complete source evidence or tax eligibility.</p>
  </section>;
}
