import { dependencyObject as object, requireDependencySources } from '../fx/dependencies';
import { fxEvidenceId } from '../fx/document-facts';
import { parseSourceEnvelope, requireNativeProjection } from './native-source-context';
import { refundReversalClosure, type RefundClosureCatalog, type RefundClosureScope } from './refund-closure';
import { refundSplitCatalog } from './refund-split-store';
import { sourceImportReversalReview, type ImportReversalContext } from './import-reversal';
type Client={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
async function read(db:Client,owner:string,name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error)throw new Error('Complete owned source review unavailable.');return parseSourceEnvelope(owner,r.data)}
export async function readCurrentRefundClosure(db:Client,owner:string,scope:RefundClosureScope){
 const kind=scope.kind,id=fxEvidenceId(scope.id),{p,source_context,dependencies}=await read(db,owner,'read_refund_reversal_graph_v3',{p_kind:kind,p_id:id});
 if(p.schema_version!=='refund-reversal-context/3'||p.kind!==kind||p.id!==id||!['original','refund','import'].includes(kind)||kind!=='import'&&!source_context.sources.some(s=>s.id===id))throw new Error('Selected refund graph changed.');
 const blocked=source_context.blocked||dependencies.blocked;
 if(p.blocked!==blocked||blocked&&p.native_context!==null)throw new Error('Blocked native totals must be withheld.');
 let native_review=null;if(!blocked){const n=object(p.native_context);requireNativeProjection(source_context,n.transactions,source_context.sources.map(s=>s.id),n.stamp);native_review=refundReversalClosure(owner,{kind,id},n as RefundClosureCatalog)}
 return{source_context,dependencies,blocked,native_review};
}
export async function readCurrentRefundSplit(db:Client,owner:string,refundValue:string){
 const refund=fxEvidenceId(refundValue),{p,source_context,dependencies}=await read(db,owner,'read_refund_split_catalog_v3',{p_refund:refund}),selected=source_context.sources.find(s=>s.id===refund);
 if(p.schema_version!=='refund-split-catalog/3'||p.refund_id!==refund||!selected||p.selected_native_eligible!==selected.native_eligible)throw new Error('Selected split source changed.');
 const blocked=!selected.native_eligible||dependencies.fx_blockers.some(b=>b.receipt_id===refund);
 if(p.blocked!==blocked||blocked&&p.native_context!==null)throw new Error('Blocked refund totals must be withheld.');
 let native_catalog=null;if(!blocked){const catalog=refundSplitCatalog(p.native_context,owner,refund),ids=source_context.sources.filter(s=>s.native_eligible).map(s=>s.id);requireNativeProjection(source_context,catalog.transactions,ids,catalog.stamp);
  // The native catalog has its own complete subset; unsupported inventory stays outside its arithmetic.
  const selectedSet=new Set(ids),fx=dependencies.fx_blockers.filter(b=>selectedSet.has(b.receipt_id));
  const native_dependencies={...dependencies,blocked:fx.length>0,counts:{sources:ids.length,fx_blockers:fx.length},sources:dependencies.sources.filter(s=>selectedSet.has(s.id)),fx_blockers:fx};
  requireDependencySources(native_dependencies,catalog.transactions,catalog.stamp);native_catalog={...catalog,fx_dependencies:native_dependencies};
 }
 return{source_context,dependencies,blocked,native_catalog};
}
export async function readCurrentImportReversal(db:Client,owner:string,importValue:string){
 const id=fxEvidenceId(importValue),{p,source_context,dependencies}=await read(db,owner,'read_source_import_reversal_context_v3',{p_id:id});
 if(p.schema_version!=='source-import-reversal-context/3'||p.owner_id!==owner||p.import_id!==id||!['review','committed','discarded'].includes(String(p.import_status))||!Array.isArray(p.operation_source_ids)||p.operation_source_ids.length>20000)throw new Error('Selected import graph unavailable.');
 const operation_source_ids=p.operation_source_ids.map(fxEvidenceId),sourceIds=new Set(source_context.sources.map(s=>s.id));
 if(new Set(operation_source_ids).size!==operation_source_ids.length||operation_source_ids.some(id=>!sourceIds.has(id)))throw new Error('Import operation sources disagree with eligibility scope.');
 const blocked=source_context.blocked||dependencies.blocked;
 if(p.blocked!==blocked||blocked&&p.native_context!==null)throw new Error('Blocked import totals must be withheld.');
 let native_review=null;if(!blocked){const n=object(p.native_context);if(n.import_id!==id||n.import_status!==p.import_status)throw new Error('Import status changed.');requireNativeProjection(source_context,n.transactions,operation_source_ids,n.financial_stamp);native_review=sourceImportReversalReview(owner,n as ImportReversalContext)}
 return{source_context,dependencies,blocked,native_review,operation_source_ids,import_id:id,import_status:String(p.import_status),financial_stamp:source_context.financial_stamp};
}
export async function readCurrentAssignmentContext(db:Client,owner:string,allocationValue:string,refundValue:string){
 const allocation=fxEvidenceId(allocationValue),refund=fxEvidenceId(refundValue),{p,source_context,dependencies}=await read(db,owner,'read_refund_assignment_context_v2',{p_allocation:allocation,p_refund:refund});
 if(p.schema_version!=='refund-assignment-context/2'||p.allocation_id!==allocation||p.refund_id!==refund||source_context.sources.length!==2||p.blocked!==(source_context.blocked||dependencies.blocked))throw new Error('Complete selected assignment scope unavailable.');
 return{source_context,dependencies,blocked:p.blocked as boolean,financial_stamp:source_context.financial_stamp};
}
