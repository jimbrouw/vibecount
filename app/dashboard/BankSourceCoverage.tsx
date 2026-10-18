import type { BankSourceCoverage } from '@/lib/records/bank-source-coverage';
import { fxAmountReadback } from '@/lib/fx/readback';
import { currencyCode } from '@/lib/fx/currency';
export default function BankSourceCoverageReadback({coverage,idPrefix="bank-source-coverage"}:{coverage:BankSourceCoverage|null;idPrefix?:string}){
 if(!coverage)return <section data-testid={`${idPrefix}-unavailable`} role="alert" className="rounded border p-4">Complete bank source coverage is unavailable. Account/source completeness is unknown; do not infer it from the native GBP choices below.</section>;
 const c=coverage.counts,unsupported=coverage.observations.filter(r=>r.representation!=='native_gbp'||r.import_status!=='discarded'&&(!r.source_complete||!r.source_available)),unavailable=coverage.observations.filter(r=>r.import_status!=='discarded'&&(!r.source_complete||!r.source_available)).length;
 return <section data-testid={idPrefix} className="space-y-3 rounded border p-4" aria-labelledby={`${idPrefix}-heading`}>
  <h2 id={`${idPrefix}-heading`} className="font-semibold">Bank source currency coverage</h2>
  <p>{c.accounts} owned accounts and {c.observations} preserved observations across all years, including discarded imports. {c.native_observations} native GBP observations; {c.foreign_observations} foreign observations; {c.invalid_observations} invalid source representations.</p>
  <p data-testid={`${idPrefix}-status`}>{c.active_blocked_observations} active observations need the complete foreign valuation or source repair workflow. {c.foreign_accounts} foreign accounts and {c.invalid_accounts} invalid accounts cannot be treated as GBP cash. Native choices do not represent all sources. {unavailable} active observations have unavailable source closure or Storage metadata; metadata does not prove readable bytes.</p>
  <p>A reviewed valuation, including {c.reviewed_zero_observations} reviewed zero valuations, is not a classification, recognised income, tax acceptance or an account balance. Original units and GBP valuations stay separate.</p>
  {unsupported.length>0&&<><p>Showing {Math.min(20,unsupported.length)} of {unsupported.length} unsupported observations. These examples are not the complete source list.</p><ul className="space-y-3">{unsupported.slice(0,20).map(r=>{
   let original=r.representation==='native_gbp'?'Retained native GBP source amount; source evidence metadata is unavailable.':'Original amount unavailable; repair the source representation.';try{if(r.representation==='native_gbp'&&r.signed_amount_pence!==null)original='Retained source cash: '+fxAmountReadback(Number(r.signed_amount_pence),'GBP')+'. Source evidence metadata is unavailable.';else if(r.original_signed_minor!==null)original=fxAmountReadback(Number(r.original_signed_minor),currencyCode(r.currency));}catch{}
   return <li key={r.id} data-testid={`${idPrefix}-${r.id}`}><a className="underline" data-testid={`${idPrefix}-link-${r.id}`} href={`/dashboard/imports?import=${r.import_id}&transaction=${r.id}#transaction-${r.id}`}>Review exact source on {r.cash_date}</a><p>{original} · {r.classification} · {r.import_status??'Import status unavailable'} · {r.valuation_status.replaceAll('_',' ')}.</p>{r.valuation&&<p>Retained GBP valuation: {fxAmountReadback(Number(r.valuation.signed_gbp_pence),'GBP')}. This is not an approved accounting amount.</p>}</li>;
  })}</ul></>}
 </section>;
}
