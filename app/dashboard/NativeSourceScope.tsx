import type { NativeSourceContext } from '@/lib/records/native-source-context';
import { BankChoiceAmount } from './BankChoiceReadback';
export default function NativeSourceScope({context:c,prefix,operationCount,selectedIds=[]}:{context:NativeSourceContext;prefix:string;operationCount?:number;selectedIds?:string[]}){
 const unsupported=c.sources.filter(s=>!s.native_eligible),selected=new Set(selectedIds),shown=[...unsupported.filter(s=>selected.has(s.id)),...unsupported.filter(s=>!selected.has(s.id))].slice(0,50);
 return <section data-testid={`${prefix}-source-scope`} className="space-y-3 rounded border p-4" aria-label="Complete source eligibility scope">
  <h2 className="font-semibold">Source representation review</h2>
  <p>{c.counts.sources} complete owned sources checked; {c.counts.native_sources} have native GBP representation; {c.counts.native_blockers} need currency or source repair review. Representation is separate from accounting approval.</p>
  {operationCount!==undefined&&<p>{operationCount} sources belong to the accounting operation. The complete eligibility scope can include additional connected sources; checking them does not create an accounting change.</p>}
  <p>{c.counts.unavailable_sources} sources have unavailable Storage metadata. Metadata does not establish readable original evidence. Original currency units, valuations and recognised GBP accounting remain separate.</p>
  {shown.length>0&&<div data-testid={`${prefix}-native-blocked`} role="status"><p>Native controls for unsupported sources are withheld. Showing {shown.length} of {unsupported.length} unsupported sources; this display is not the complete source inventory.</p><ul className="space-y-2">{shown.map(s=><li key={s.id}><BankChoiceAmount source={s}/> · {s.cash_date} · {s.classification}. <a className="underline" data-testid={`${prefix}-source-${s.id}`} href={`/dashboard/imports?import=${s.import_id}&transaction=${s.id}#transaction-${s.id}`}>Review exact source</a></li>)}</ul></div>}
 </section>;
}
