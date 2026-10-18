import { type BankSourceCoverage } from './bank-source-coverage';
import { currencyMinor } from '../fx/currency';
import { minorPence } from './allocations';
export type BankChoiceSource = BankSourceCoverage['observations'][number];
export function bankChoiceIndex(coverage:BankSourceCoverage){return{owner_id:coverage.owner_id,observations:new Map(coverage.observations.map(r=>[r.id,r]))}}
type ChoiceScope=BankSourceCoverage|ReturnType<typeof bankChoiceIndex>;
export type BankChoiceRow = { user_id?: string; id: string; transaction_date: string; currency: string; signed_amount_pence: unknown; account_id?: string; import_id?: string; source_row_id?: string; decision_version?: number; classification?: string; dedupe_status?: string; import_status?: string | null; original_signed_minor?: unknown; source_units_ruleset?: unknown; file_hash?:string;row_hash?:string;parser_version?:string };
function choiceUnits(value:unknown):number|null{if(value===null)return null;if(typeof value==='number')return currencyMinor(value);if(typeof value!=='string'||value.length>13||!/^(-?[1-9]\d*|0)$/.test(value))throw new Error('Exact choice units unavailable.');return currencyMinor(Number(value))}
/** A projection cannot silently contradict the owned immutable source or current decision state. */
export function bankChoiceSource(coverage: ChoiceScope, row: BankChoiceRow): BankChoiceSource {
 if(typeof row.currency!=='string'||typeof row.transaction_date!=='string'||row.user_id!==undefined&&row.user_id!==coverage.owner_id)throw new Error('Owned choice identity unavailable.');
 const source=Array.isArray(coverage.observations)?coverage.observations.find(s=>s.id===row.id):coverage.observations.get(row.id);
 if(!source)throw new Error('Choice source is missing from complete bank coverage.');
 const keys={account_id:'account_id',import_id:'import_id',source_row_id:'source_row_id',transaction_date:'cash_date',currency:'currency',decision_version:'decision_version',classification:'classification',dedupe_status:'dedupe_status',import_status:'import_status',file_hash:'file_sha256',row_hash:'row_sha256',parser_version:'parser_version'}as const;
 for(const [key,sourceKey]of Object.entries(keys)as [keyof typeof keys,typeof keys[keyof typeof keys]][])if(Object.hasOwn(row,key)&&row[key]!==source[sourceKey])throw new Error('Choice metadata contradicts current bank coverage.');
 const cash=row.signed_amount_pence===null?null:choiceUnits(row.signed_amount_pence),expected=source.signed_amount_pence===null?null:choiceUnits(source.signed_amount_pence);
 if(cash!==expected)throw new Error('Choice cash contradicts the retained bank source.');
 if(Object.hasOwn(row,'original_signed_minor')&&(row.original_signed_minor===null?null:choiceUnits(row.original_signed_minor))!==(source.original_signed_minor===null?null:choiceUnits(source.original_signed_minor)))throw new Error('Choice original units contradict the retained bank source.');
 if(Object.hasOwn(row,'source_units_ruleset')&&row.source_units_ruleset!==source.ruleset_id)throw new Error('Choice unit rules contradict the retained bank source.');
 return source;
}
export function nativeBankChoice(coverage: ChoiceScope, row: BankChoiceRow): boolean { return bankChoiceSource(coverage,row).representation==='native_gbp'; }
export function nativeBankIds(coverage:BankSourceCoverage,ids:string[]):boolean {
 if(new Set(ids).size!==ids.length)throw new Error('Duplicate selected bank endpoints.');
 return ids.every(id=>{const s=coverage.observations.find(r=>r.id===id);if(!s)throw new Error('Selected bank endpoint is missing from complete coverage.');return s.representation==='native_gbp'});
}
/** Peers omitted by a view join are unavailable, never a smaller complete identity group. */
export function nativeDuplicateCohort<T extends BankChoiceRow & {account_id:string;fingerprint:string;peer_count:string|number}>(coverage:BankSourceCoverage,rows:T[],selected:string):boolean {
 const subject=rows.find(r=>r.id===selected);if(!subject||typeof subject.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(subject.fingerprint)||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Complete duplicate cohort unavailable.');
 const index=bankChoiceIndex(coverage);let eligible=true;for(const row of rows){if(row.account_id!==subject.account_id||row.fingerprint!==subject.fingerprint||minorPence(row.peer_count)!==rows.length-1)throw new Error('Duplicate cohort count or identity changed.');if(!nativeBankChoice(index,row))eligible=false}
 return eligible;
}
