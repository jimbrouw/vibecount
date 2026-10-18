/** Native synthetic route harness only; self-contained for esbuild fixture serialization. */
export function nativeExportCoverageFixture(owner: string, source: {id:string;account_id:string;file_hash:string;parser_version:string;status:string}, rows: Record<string,unknown>[], records: Record<string,unknown>[]) {
  const observations = rows.map(r => ({ id:r.id,account_id:source.account_id,import_id:source.id,source_row_id:r.source_row_id,
    cash_date:r.transaction_date,tax_year_start:r.tax_year_start,currency:r.currency,signed_amount_pence:String(r.signed_amount_pence),
    original_signed_minor:null,ruleset_id:null,import_status:source.status,classification:r.classification,dedupe_status:r.dedupe_status,
    decision_version:r.decision_version,source_complete:true,source_available:true,file_sha256:source.file_hash,
    row_sha256:(r.source_rows as {row_hash:string}).row_hash,parser_version:source.parser_version,representation:'native_gbp',
    valuation_status:'not_applicable',valuation:null,approved_record_count:records.filter(v=>v.bank_transaction_id===r.id&&v.status==='approved').length }));
  return {schema_version:'vibecount.bank-source-coverage/1',scope:'all_owned_accounts_and_observations; original_units_are_not_gbp_valuation_or_tax_acceptance',owner_id:owner,stamp:'a'.repeat(64),
    counts:{accounts:1,native_accounts:1,foreign_accounts:0,invalid_accounts:0,observations:rows.length,native_observations:rows.length,foreign_observations:0,invalid_observations:0,active_blocked_observations:0,reviewed_zero_observations:0},
    accounts:[{id:source.account_id,currency:'GBP',representation:'native_gbp'}],observations};
}
