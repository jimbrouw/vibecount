// Synthetic metadata only; not source verification or an authoritative database token.
import type { InvoiceCoverageRow, InvoiceCurrencyCoverage } from './currency-coverage';
import { INVOICE_CURRENCY_COVERAGE_SCOPE, INVOICE_CURRENCY_COVERAGE_VERSION } from './currency-coverage';
import { sha256, canonicalJson } from '../tax/snapshot';
export function syntheticCoverage(owner = 'owner', invoices: InvoiceCoverageRow[] = [], drafts = 0): InvoiceCurrencyCoverage {
  const value: Omit<InvoiceCurrencyCoverage, 'stamp'> = { schema_version: INVOICE_CURRENCY_COVERAGE_VERSION, scope: INVOICE_CURRENCY_COVERAGE_SCOPE, owner_id: owner, invoice_count: invoices.length,
    native_invoice_count: invoices.filter(i => i.representation === 'native_gbp').length, unsupported_external_invoice_count: invoices.filter(i => i.representation === 'unsupported_external').length,
    invalid_invoice_count: invoices.filter(i => i.representation === 'invalid').length, draft_invoice_count: drafts, invoices };
  return { ...value, stamp: sha256(canonicalJson(value)) };
}
export function syntheticExternal(currency = 'USD', minor = '100001', id = '11111111-1111-4111-8111-111111111111'): InvoiceCoverageRow {
  return { id, status: 'finalised', origin: 'preserved_external', currency, invoice_date: '2024-04-05', amount: null, original_total_minor: minor, currency_ruleset_id: 'vibecount-currencies/1', source_fact_revision_id: '22222222-2222-4222-8222-222222222222', source_fact_family_id: '33333333-3333-4333-8333-333333333333', native_balance_available: false, representation: 'unsupported_external' };
}
