import type { BankChoiceSource } from '@/lib/records/native-choice';
import { bankOriginalMinor } from '@/lib/records/bank-source-coverage';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { fxAmountReadback } from '@/lib/fx/readback';
import { currencyCode } from '@/lib/fx/currency';
export function BankChoiceAmount({source}:{source:Pick<BankChoiceSource,'representation'|'signed_amount_pence'|'original_signed_minor'|'currency'>}){
 if(source.representation==='native_gbp'){const p=bankOriginalMinor(source.signed_amount_pence);return <>{formatPounds(p)} ({signedAmountToWords(p)})</>}
 let original='Original amount unavailable; source representation needs repair.';
 try{if(source.original_signed_minor!==null)original=fxAmountReadback(bankOriginalMinor(source.original_signed_minor),currencyCode(source.currency))}catch{}
 return <>{original} · Native GBP financial review unavailable</>;
}
export function BankChoiceWithheld({sources,prefix='bank-choice'}:{sources:BankChoiceSource[];prefix?:string}){
 return <section data-testid={`${prefix}-withheld`} role="status" className="space-y-2 rounded border p-4"><h2 className="font-semibold">Selected source needs currency or representation review</h2><p>Native financial controls are withheld for this selected scope. Original currency amounts and retained valuations are separate from recognised GBP cash.</p><ul>{sources.map(source=><li key={source.id}><BankChoiceAmount source={source}/> · {source.cash_date} · {source.classification}. <a data-testid={`${prefix}-source-${source.id}`} className="underline" href={`/dashboard/imports?import=${source.import_id}&transaction=${source.id}#transaction-${source.id}`}>Review exact source</a></li>)}</ul></section>;
}
