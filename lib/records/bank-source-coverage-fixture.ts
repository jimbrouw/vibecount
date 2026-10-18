import { BANK_SOURCE_COVERAGE_SCOPE, BANK_SOURCE_COVERAGE_VERSION } from './bank-source-coverage';
export const bankCoverageFixtureId=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
/** Synthetic metadata only; never a hosted source or proof of financial treatment. */
export function bankSourceCoverageFixture(owner=bankCoverageFixtureId(1),n=0,year=2026){
 const accounts=n?[{id:bankCoverageFixtureId(20),currency:'GBP',representation:'native_gbp'}]:[];
 const observations=Array.from({length:n},(_,i)=>({id:bankCoverageFixtureId(i+100),account_id:bankCoverageFixtureId(20),import_id:bankCoverageFixtureId(10),source_row_id:bankCoverageFixtureId(i+800),cash_date:`${year}-04-06`,tax_year_start:year,currency:'GBP',signed_amount_pence:'100',original_signed_minor:null,ruleset_id:null,import_status:'review',classification:'Unknown',dedupe_status:'clear',decision_version:0,source_complete:true,source_available:true,file_sha256:'a'.repeat(64),row_sha256:'b'.repeat(64),parser_version:'mapped-csv/1',representation:'native_gbp',valuation_status:'not_applicable',valuation:null,approved_record_count:0}));
 return{schema_version:BANK_SOURCE_COVERAGE_VERSION,scope:BANK_SOURCE_COVERAGE_SCOPE,owner_id:owner,stamp:'a'.repeat(64),counts:{accounts:accounts.length,native_accounts:accounts.length,foreign_accounts:0,invalid_accounts:0,observations:n,native_observations:n,foreign_observations:0,invalid_observations:0,active_blocked_observations:0,reviewed_zero_observations:0},accounts,observations};
}
