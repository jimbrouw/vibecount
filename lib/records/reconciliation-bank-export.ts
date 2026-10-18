import { dimensionedReconciliationExportTable, type DimensionedReconciliationInput } from './reconciliation-dimensioned-export';
import type { BankExportContext } from './bank-export-context';
import { canonicalJson } from '../tax/snapshot';
import { escapeCsv } from './export-csv';

export const BANK_RECONCILIATION_SCHEMA = 'vibecount.reconciliation/6';
/** All bank observations accompany existing invoice and relationship rows; only source rows own source cash. */
export function bankReconciliationExport(input: DimensionedReconciliationInput, bank: BankExportContext) {
  if (bank.snapshot.owner_id !== input.owner || bank.snapshot.import_id !== null) throw new Error('Complete owned bank inventory required.');
  const observations = bank.snapshot.observations, byId = new Map(observations.map(r => [r.id,r]));
  const expectedReceipts = observations.filter(r => r.signed_amount_pence !== null && Number(r.signed_amount_pence) > 0);
  if (input.legacy[1].length !== expectedReceipts.length) throw new Error('Complete receipt/source inventory differs.');
  for (const receipt of input.legacy[1]) {
    const source = byId.get(receipt.id);
    if (!source || source.representation !== 'native_gbp' || source.signed_amount_pence !== String(receipt.signed_amount_pence) ||
        source.source_row_id !== receipt.source_row_id || source.import_id !== receipt.import_id || source.cash_date !== receipt.transaction_date)
      throw new Error('Receipt/source dimensions differ.');
  }
  const base = dimensionedReconciliationExportTable(input);
  const extra = ['bank_context_sha256','bank_account_id','bank_account_currency','bank_import_id','bank_import_status','bank_original_currency','bank_currency_exponent','bank_source_units_ruleset','bank_original_signed_minor','bank_actual_signed_gbp_pence','bank_representation','bank_valuation_status','bank_valuation_history_json','bank_financial_records_json','bank_recognized_income_pence','bank_recognized_expense_pence','bank_recognized_profit_pence','bank_source_context_json'];
  const header = [...base.header,...extra], index = new Map(header.map((v,i)=>[v,i]));
  header.push('bank_current_valuation_documents_json');index.set('bank_current_valuation_documents_json',header.length-1);
  const set = (row:string[], values:Record<string,unknown>) => {for(const[k,v]of Object.entries(values))row[index.get(k)!]=v===null?'':String(v)};
  const rows = base.rows.map(r => {
    const row = [...r,...extra.map(()=>''),''];
    set(row,{reconciliation_schema_version:BANK_RECONCILIATION_SCHEMA,bank_context_sha256:bank.snapshot_sha256});
    if(row[index.get('row_kind')!]==='receipt_balance')set(row,{row_semantics:'receipt allocation balance; source cash appears once in bank_source_observation; do not sum both'});
    return row;
  });
  for(const source of observations){
    const row=Array<string>(header.length).fill('');
    set(row,{document_status:'Draft — not submitted to HMRC',row_kind:'bank_source_observation',reconciliation_schema_version:BANK_RECONCILIATION_SCHEMA,
      transaction_id:source.id,source_row_id:source.source_row_id,source_row_number:source.source_row_number,source_row_sha256:source.row_sha256,
      file_sha256:source.file_sha256,date:source.cash_date,classification_or_status:source.classification,
      bank_context_sha256:bank.snapshot_sha256,bank_account_id:source.account_id,bank_account_currency:source.account_currency,
      bank_import_id:source.import_id,bank_import_status:source.import_status,bank_original_currency:source.currency,
      bank_currency_exponent:source.currency_exponent,bank_source_units_ruleset:source.ruleset_id,bank_original_signed_minor:source.original_signed_minor,
      bank_actual_signed_gbp_pence:source.actual_signed_gbp_pence,bank_representation:source.representation,bank_valuation_status:source.valuation_status,
      bank_valuation_history_json:canonicalJson(source.valuation_history),bank_financial_records_json:canonicalJson(source.financial_records),
      bank_recognized_income_pence:source.recognized_income_pence,bank_recognized_expense_pence:source.recognized_expense_pence,
      bank_recognized_profit_pence:source.recognized_profit_pence,bank_source_context_json:canonicalJson(source),
      bank_current_valuation_documents_json:canonicalJson(bank.snapshot.current_valuation_documents.filter(d=>source.valuation_history.some(v=>v.document_id===d.id))),
      row_semantics:'one source observation; original units, actual GBP cash, retained valuations and recognized GBP effects are separate; no cross-currency sum'});
    rows.push(row);
  }
  const csv=[header,...rows].map(row=>row.map(escapeCsv).join(',')).join('\r\n');
  if(Buffer.byteLength(csv)>4_000_000)throw new Error('Complete reconciliation exceeds download capacity.');
  return{csv,count:rows.length,schema_version:BANK_RECONCILIATION_SCHEMA};
}
