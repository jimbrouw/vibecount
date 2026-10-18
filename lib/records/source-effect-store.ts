import { readAllExportRows } from './export-pages';
import type { SourceExportRow, SourceExportRecord, SourceRefundPortion } from './source-export';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
/** Page child tables independently: nested to-many embeddings can be capped by PostgREST. */
export async function attachSourceEffects<T extends Omit<SourceExportRow, 'signed_amount_pence'> & { signed_amount_pence: number | string | null }>(db: Client, owner: string, importId: string | undefined, rows: T[]) {
    const [records,portions]=await Promise.all([
        readAllExportRows<SourceExportRecord & {bank_transaction_id:string}>(async after=>{
            let q=db.from('financial_records').select('id,amount,status,record_type,effect_sign,refund_link_id,bank_transaction_id,record_date,category_id,project_id,transaction:bank_transactions!records_bank_transaction_owner_fk!inner(import_id)')
                .eq('user_id',owner).order('id').limit(500);
            if(importId!==undefined)q=q.eq('transaction.import_id',importId);
            if(after)q=q.gt('id',after);const r=await q;return {data:r.data as unknown as (SourceExportRecord & {bank_transaction_id:string})[]|null,error:r.error};
        }),
        readAllExportRows<SourceRefundPortion>(async after=>{
            let q=db.from('refund_links').select('id,original_transaction_id,refund_transaction_id,amount_pence,recognized_pence,record_type,business_use_bps,category_id,request_id,refund:bank_transactions!refund_links_refund_owner_fk!inner(import_id),original:bank_transactions!refund_links_original_owner_fk(id,import_id,source_row_id,transaction_date),reversals:refund_reversals(id)')
                .eq('user_id',owner).order('id').limit(500);
            if(importId!==undefined)q=q.eq('refund.import_id',importId);
            if(after)q=q.gt('id',after);const r=await q;return {data:r.data as unknown as SourceRefundPortion[]|null,error:r.error};
        }),
    ]);
    const byId=new Map(rows.map(r=>[r.id,r])),recordMap=new Map<string,SourceExportRecord[]>(),portionMap=new Map<string,SourceRefundPortion[]>();
    for(const r of records){if(!byId.has(r.bank_transaction_id))throw new Error('Accounting effect outside the complete owned import.');const selected=recordMap.get(r.bank_transaction_id)??[];selected.push(r);recordMap.set(r.bank_transaction_id,selected);}
    for(const l of portions){if(!byId.has(l.refund_transaction_id))throw new Error('Refund portion outside the complete owned import.');const selected=portionMap.get(l.refund_transaction_id)??[];selected.push(l);portionMap.set(l.refund_transaction_id,selected);}
    return rows.map(r=>({...r,record:recordMap.get(r.id)??[],refund_portions:portionMap.get(r.id)??[]}));
}
