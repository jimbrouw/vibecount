// Pure synthetic projections only. No agent session, database or provider connection.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { nativeInvoiceRead, quarterReads, signedRecordRead } from '../lib/mcp/read-boundary';

async function main() {
  const owner = 'synthetic-owner';
  const invoice = { id: 'synthetic-invoice', user_id: owner, status: 'finalised', origin: 'native_gbp', currency: 'GBP', amount: '123.45', original_total_minor: null, currency_ruleset_id: null, source_fact_revision_id: null, source_fact_family_id: null, number: 'DEMO-1', invoice_date: '2026-04-05', due_date: null, delivery_status: 'draft', paid_at: null, clients: { name: 'Synthetic client', user_id: owner } };
  const refund = { id: 'synthetic-refund', user_id: owner, record_type: 'expense', status: 'approved', record_date: '2026-04-05', description: 'Synthetic refund 12345678', amount: '30.01', effect_sign: -1, record_categories: { name: 'Software', user_id: null, is_default: true } };
  const externalRejected = ['GBP', 'USD', 'JPY', 'KWD'].map(currency => {
    assert.throws(() => nativeInvoiceRead({ ...invoice, origin: 'preserved_external', currency, amount: null }, owner));
    return { currency, result: 'unavailable; no native GBP amount returned' };
  });
  const native = nativeInvoiceRead(invoice, owner), expenseRefund = signedRecordRead(refund, owner, true);
  const quarters = quarterReads([{ user_id: owner, tax_year_start: 2025, tax_quarter: 4, income_total: '100.01', expense_total: '-30.01', net_total: '130.02', income_count: 1, expense_count: 1 }], owner, 2025);
  assert.equal(native.amount_pence, 12345); assert.equal(expenseRefund.amount_pence, -3001); assert.equal(quarters[0].net_profit_pence, 13002);
  const output = '/tmp/vibecount-parked-read-demo'; await mkdir(output, { recursive: true });
  await writeFile(output + '/projections.json', JSON.stringify({ native, expenseRefund, quarters, externalRejected }, null, 2) + '\n');
  await writeFile(output + '/README.md', '# Synthetic parked-read containment\n\nPure projections show unchanged GBP 123.45 native invoice, a signed GBP -30.01 supplier refund and exact GBP 130.02 net profit, with bank-number redaction. External GBP/USD/JPY/KWD candidates return no native amount. This is not an invoice settlement, tax calculation, complete ledger, hosted permission test or new agent capability. Actual route auth/query/audit failures are covered separately by inert route tests. No database, session, provider, approval, payment, send or filing occurs.\n');
  console.log('Verified synthetic read projections: ' + output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
