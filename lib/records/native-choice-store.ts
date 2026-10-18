import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBankSourceCoverage } from './bank-source-coverage';
import { readFinancialStamp } from './consistent-reconciliation';
import { readAllExportRows } from './export-pages';
import { canonicalJson } from '../tax/snapshot';
import { fxEvidenceId } from '../fx/document-facts';
type Client=Pick<SupabaseClient,'rpc'|'from'>;
export type BankChoiceAccount={id:string;user_id:string;currency:string;account_type:string};
export async function readBankChoiceContext(db:Client,owner:string){
 const coverage=await readBankSourceCoverage(db,owner),financial_stamp=await readFinancialStamp(()=>db.rpc('reconciliation_export_stamp'));
 const accounts=await readAllExportRows<BankChoiceAccount>(async after=>{let q=db.from('financial_accounts').select('id,user_id,currency,account_type').eq('user_id',owner).order('id').limit(500);if(after)q=q.gt('id',after);const r=await q;return{data:r.data as BankChoiceAccount[]|null,error:r.error}});
 if(accounts.length!==coverage.accounts.length||accounts.some(a=>fxEvidenceId(a.user_id)!==owner||!['bank','credit_card'].includes(a.account_type)||!coverage.accounts.some(c=>c.id===fxEvidenceId(a.id)&&c.currency===a.currency)))throw new Error('Complete owned account choices unavailable.');
 return{coverage,financial_stamp,accounts};
}
export function assertBankChoiceAccountTypes(accounts:BankChoiceAccount[],rows:{account_id?:string;account_type?:string}[]){
 const types=new Map(accounts.map(a=>[a.id,a.account_type]));for(const row of rows)if(row.account_type!==undefined&&types.get(row.account_id??'')!==row.account_type)throw new Error('Choice account type changed.');
}
export async function finishBankChoiceContext(db:Client,owner:string,before:Awaited<ReturnType<typeof readBankChoiceContext>>){
 const after=await readBankChoiceContext(db,owner);
 if(before.financial_stamp!==after.financial_stamp||canonicalJson(before.coverage)!==canonicalJson(after.coverage)||canonicalJson(before.accounts)!==canonicalJson(after.accounts))throw new Error('Bank source choices changed while reading.');
 return before.coverage;
}
