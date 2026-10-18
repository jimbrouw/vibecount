import { fxEvidenceId } from './document-facts';
import { sourceImportReversalReview, type ImportReversalContext } from '../records/import-reversal';
import { dependencyObject as object, parseFxDependencies } from './dependencies';
export function importReversalDependencyReview(ownerValue:string,value:unknown){
 const owner=fxEvidenceId(ownerValue),p=object(value);
 if(p.schema_version!=='source-import-reversal-context/2'||p.owner_id!==owner||typeof p.blocked!=='boolean'||typeof p.financial_stamp!=='string'||p.financial_stamp.length!==32||!/^[a-f0-9]{32}$/.test(p.financial_stamp)||!['review','committed','discarded'].includes(String(p.import_status)))throw new Error('Owned complete import dependency context unavailable.');
 const import_id=fxEvidenceId(p.import_id);
 const context=parseFxDependencies(owner,{...p,schema_version:'fx-source-dependencies/1'}),sources=context.sources,blockers=context.fx_blockers;
 const sourceMap=new Map(sources.map(s=>[s.id,s]));
 if(blockers.length){if(p.native_context!==null)throw new Error('Native reversal totals must be withheld while FX is linked.');return{schema_version:'source-import-fx-blocked-review/1' as const,owner_id:owner,import_id,import_status:String(p.import_status),financial_stamp:p.financial_stamp,blocked:true as const,sources,fx_blockers:blockers,financial_action:'preview_only' as const};}
 const native=sourceImportReversalReview(owner,p.native_context as ImportReversalContext);
 if(native.import_id!==import_id||native.import_status!==p.import_status||native.financial_stamp!==p.financial_stamp)throw new Error('Native dependency context changed.');
 const raw=object(p.native_context);if(!Array.isArray(raw.transactions)||raw.transactions.length!==sources.length)throw new Error('Complete native source scope disagrees.');
 for(const v of raw.transactions){const r=object(v),s=sourceMap.get(fxEvidenceId(r.id));if(!s||s.import_id!==r.import_id||s.source_row_id!==r.source_row_id||s.transaction_date!==r.transaction_date)throw new Error('Complete native source scope disagrees.');}
 return native;
}
export type FxBlockedImportReview=Extract<ReturnType<typeof importReversalDependencyReview>,{schema_version:'source-import-fx-blocked-review/1'}>;
