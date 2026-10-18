import type { PGlite } from '@electric-sql/pglite';
import type { DimensionedReconciliationInput } from '../records/reconciliation-dimensioned-export';
import { INVOICE_REPORTING_COLUMNS } from '../invoices/reporting';
import { INVOICE_FACT_EXPORT_COLUMNS } from '../records/reconciliation-currency-export';
import { FX_EVENT_COLUMNS } from '../fx/settlement-history';

/** Disposable fixture reader, not an application store. Reads actual SQL sources
 * for the native/FX-only fixture; production paging is verified by route tests. */
export async function readFxExportFixture(db: PGlite, owner: string): Promise<DimensionedReconciliationInput> {
  const rows = async <T>(query: string) => (await db.query<{ r: T }>(query, [owner])).rows.map(row => row.r);
  for (const table of ['transfer_pairs','refund_links','invoice_credit_notes','invoice_refund_assignments']) {
    if ((await db.query(`select id from ${table} where user_id=$1`, [owner])).rows.length)
      throw new Error('This fixture reader requires the native/FX-only scenario.');
  }
  const bankSource = `jsonb_build_object('id',t.id,'transaction_date',t.transaction_date,'source_row_id',t.source_row_id,
    'source_rows',jsonb_build_object('row_number',s.row_number,'row_hash',s.row_hash),
    'record_imports',jsonb_build_object('file_hash',i.file_hash,'parser_version',i.parser_version))`;
  const events = await rows<DimensionedReconciliationInput['events'][number]>(`select to_jsonb(v) r from (
    select ${FX_EVENT_COLUMNS.split(',').map(c => 'e.' + c).join(',')},${bankSource} transaction
    from invoice_settlements e join bank_transactions t on t.id=e.transaction_id and t.user_id=e.user_id
    join source_rows s on s.id=t.source_row_id and s.user_id=t.user_id
    join record_imports i on i.id=t.import_id and i.user_id=t.user_id where e.user_id=$1 order by e.id) v`);
  const receipts = await rows<DimensionedReconciliationInput['legacy'][1][number]>(`select to_jsonb(v) r from (
    select b.id,b.import_id,b.transaction_date,b.signed_amount_pence,b.allocated_pence,b.unallocated_pence,b.classification,b.record_status,
    b.active_transfer_id,b.active_refund_id,b.refunded_pence,b.source_row_id,
    jsonb_build_object('row_number',s.row_number,'row_hash',s.row_hash) source_rows,jsonb_build_object('file_hash',i.file_hash) record_imports
    from receipt_allocation_balances b join source_rows s on s.id=b.source_row_id and s.user_id=b.user_id
    join record_imports i on i.id=b.import_id and i.user_id=b.user_id where b.user_id=$1 order by b.id) v`);
  const invoices = await rows<DimensionedReconciliationInput['legacy'][2][number]>(`select to_jsonb(v) r from (
    select id,number,currency,status,invoice_pence,allocated_pence,outstanding_pence,credited_pence,entitlement_pence,refund_due_pence,retained_cash_pence,returned_pence,delivery_status
    from invoice_payment_balances where user_id=$1 and status='finalised' order by id) v`);
  const documents = await rows<DimensionedReconciliationInput['documents'][number]>(`select to_jsonb(v) r from (
    select ${INVOICE_REPORTING_COLUMNS},number,invoice_date from invoices where user_id=$1 and status='finalised' order by id) v`);
  const facts = await rows<DimensionedReconciliationInput['facts'][number]>(`select to_jsonb(v) r from (
    select ${INVOICE_FACT_EXPORT_COLUMNS} from fx_document_fact_revisions where user_id=$1 and id in
    (select source_fact_revision_id from invoices where user_id=$1 and status='finalised') order by id) v`);
  const lots = await rows<unknown>('select to_jsonb(l) r from fx_lot_export_sources l where user_id=$1 order by id');
  const external = await rows<DimensionedReconciliationInput['external_balances'][number]>('select to_jsonb(b) r from external_invoice_settlement_balances b where user_id=$1 order by id');
  return { owner, events, documents, facts, fx_lots: lots, external_balances: external, legacy: [[], receipts, invoices, [], [], [], [], [], [], [], []] };
}
