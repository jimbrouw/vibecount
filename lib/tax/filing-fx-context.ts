import { parseFxProvenance } from '../fx/provenance';
import { minorPence } from '../records/allocations';
import { sumPence } from '../money';
import { invoiceOriginalAmount } from '../invoices/reporting';
import type { InvoiceCurrencyCoverage } from '../invoices/currency-coverage';

type Row = { id: string; [key: string]: unknown };
/** New input version only: retain old pack validators/serializers unchanged. */
export function validateFilingFxContext(input: { owner_id: string; fx_provenance: unknown; observations: Row[]; receipt_balances: Row[];
  invoice_coverage: InvoiceCurrencyCoverage; reconciliation: { id: string; kind: string; data: Record<string,unknown> }[] }) {
  const fx = parseFxProvenance(input.owner_id,input.fx_provenance,input.observations), invoices = new Map(input.invoice_coverage.invoices.map(i=>[i.id,i]));
  const activeOriginal = new Map<string,number[]>(), activeCash = new Map<string,number[]>(), nativeCash = new Map<string,number[]>();
  const add=(map:Map<string,number[]>,id:string,value:number)=>map.set(id,[...(map.get(id)??[]),value]);
  const reversedFx = new Set(fx.events.flatMap(e=>e.reverses_id?[e.reverses_id]:[]));
  for(const lot of fx.lots){
    const invoice=invoices.get(lot.invoice_id);
    if(!invoice||invoice.representation!=='unsupported_external'||(lot.event_count>0&&(invoice.currency!==lot.invoice_currency||invoice.source_fact_revision_id!==lot.invoice_fact_revision_id||invoiceOriginalAmount(invoice).minor!==lot.invoice_snapshot.original_total_minor)))
      throw new Error('Retained FX canonical invoice coverage unavailable.');
  }
  for(const e of fx.events)if(e.event_kind==='allocation'&&!reversedFx.has(e.id)){add(activeOriginal,e.invoice_id,e.invoice_minor);add(activeCash,e.transaction_id,e.amount_pence);}
  for(const[id,values]of activeOriginal)if(sumPence(values)>invoiceOriginalAmount(invoices.get(id)!).minor)throw new Error('FX original invoice capacity disagrees.');
  if(input.reconciliation.some(e=>fx.events.some(f=>f.id===e.id)))throw new Error('FX history must appear exactly once.');
  const native=input.reconciliation.filter(e=>e.kind==='settlement'),byId=new Map(native.map(e=>[e.id,e])),reversed=new Set<string>();
  if(byId.size!==native.length)throw new Error('Unique native settlement history required.');
  for(const e of native){const d=e.data;
    if(typeof d.invoice_id!=='string'||typeof d.transaction_id!=='string'||invoices.get(d.invoice_id)?.representation!=='native_gbp'||minorPence(d.amount_pence as number|string)<=0)throw new Error('Native filing settlement dimensions unavailable.');
    if(d.event_kind==='reversal'){
      const parent=typeof d.reverses_id==='string'?byId.get(d.reverses_id):undefined;
      if(!parent||parent.data.event_kind!=='allocation'||parent.data.invoice_id!==d.invoice_id||parent.data.transaction_id!==d.transaction_id||minorPence(parent.data.amount_pence as number|string)!==minorPence(d.amount_pence as number|string)||reversed.has(parent.id))throw new Error('Native filing reversal ancestry unavailable.');
      reversed.add(parent.id);
    }else if(d.event_kind!=='allocation'||d.reverses_id!==null)throw new Error('Native filing settlement history unavailable.');
  }
  for(const e of native)if(e.data.event_kind==='allocation'&&!reversed.has(e.id))add(nativeCash,e.data.transaction_id as string,minorPence(e.data.amount_pence as number|string));
  const receipts=new Map(input.receipt_balances.map(r=>[r.id,r]));if(receipts.size!==input.receipt_balances.length)throw new Error('Unique filing receipt balances required.');
  const observations=new Map(input.observations.map(o=>[o.id,o]));
  for(const r of receipts.values()){
    const source=observations.get(r.id);
    if(!source||source.currency!=='GBP'||r.transaction_date!==source.transaction_date||minorPence(r.signed_amount_pence as number|string)!==minorPence(source.signed_amount_pence as number|string))throw new Error('Filing receipt balance and source observation disagree.');
    const allocated=sumPence([...(nativeCash.get(r.id)??[]),...(activeCash.get(r.id)??[])]),observed=minorPence(source.signed_amount_pence as number|string);
    if(observed<=0||allocated>observed||minorPence(r.allocated_pence as number|string)!==allocated||minorPence(r.unallocated_pence as number|string)!==observed-allocated)throw new Error('Complete native/FX filing receipt cash disagrees.');
  }
  if([...native.map(e=>e.data.transaction_id as string),...activeCash.keys(),...fx.lots.map(l=>l.receipt_id)].some(id=>!receipts.has(id)))throw new Error('Complete filing receipt balance unavailable.');
  if(input.observations.some(o=>o.currency==='GBP'&&minorPence(o.signed_amount_pence as number|string)>0&&!receipts.has(o.id)))throw new Error('Complete positive source receipt balances unavailable.');
  return fx;
}
