import type { CalculationInput } from '@/lib/tax/calculation';
import type { BankAccountingCoverageInput } from '@/lib/records/bank-accounting-coverage';
import { bankAccountingTaxScope } from '@/lib/tax/bank-accounting-scope';
import { fxAmountReadback } from '@/lib/fx/readback';
import { currencyCode } from '@/lib/fx/currency';

export default function BankAccountingCoverage({input,coverage,connected=[]}:{input:CalculationInput;coverage:BankAccountingCoverageInput;connected?:string[]}){
 const scope=bankAccountingTaxScope(input,coverage,connected),model=scope.accounting_coverage;
 const sources=new Map(model.source_coverage.observations.map(r=>[r.id,r]));
 const rows=model.accounting.filter(a=>sources.get(a.transaction_id)!.tax_year_start===input.tax_year_start||scope.source_ids.includes(a.transaction_id));
 return <section className="space-y-3 rounded border p-4" data-testid="bank-accounting-coverage" aria-labelledby="bank-accounting-heading">
  <h2 id="bank-accounting-heading" className="font-semibold">Bank accounting evidence</h2>
  <p data-testid="bank-accounting-status">{scope.source_count} active or connected source observations. {scope.blocked_ids.length} need source or accounting review before dependent tax estimates can be shown.</p>
  <p>Confirmed GBP accounting effects contribute once to the ledger. Original currency amounts and valuation history are supporting evidence, not additional income or expenses. Tax treatment and completeness still require review.</p>
  <p>Transaction valuations do not establish accessible GBP bank cash. Foreign account balances remain separate from safe-to-draw estimates.</p>
  {rows.length>0&&<><p>Showing {Math.min(rows.length,20)} of {rows.length} foreign observations in this year or its connected evidence, including preserved exclusions.</p><ul className="space-y-3">{rows.slice(0,20).map(a=>{const source=sources.get(a.transaction_id)!;return <li key={a.transaction_id} data-testid={`bank-accounting-${a.transaction_id}`}>
   <a className="underline" data-testid={`bank-accounting-link-${a.transaction_id}`} href={`/dashboard/imports?import=${source.import_id}&transaction=${a.transaction_id}#transaction-${a.transaction_id}`}>Review source on {source.cash_date}</a>
   <p>{source.original_signed_minor===null?'Original amount unavailable':fxAmountReadback(Number(source.original_signed_minor),currencyCode(source.currency))} · {source.classification} · {a.status.replaceAll('_',' ')}.</p>
   <p>Recorded income: {fxAmountReadback(a.recognized_income_pence,'GBP')}. Recorded expense: {fxAmountReadback(a.recognized_expense_pence,'GBP')}.</p>
   {!a.eligible&&<p>Retained amounts do not establish current tax eligibility.</p>}
  </li>})}</ul></>}
 </section>;
}
