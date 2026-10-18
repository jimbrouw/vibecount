import Link from 'next/link';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
export const metadata={title:'Evidence deletion impact — VibeCount'};
const labels:Record<string,string>={unresolved_upload_operations:'Uploads still running or with an unknown outcome',content_hashes:'Distinct file contents',registered_documents:'Registered documents',imports:'Imports across accounts',retained_object_paths:'Stored object locations, including duplicate attempts',present_objects:'Objects currently present',raw_source_rows:'Encrypted original CSV rows',document_name_copies:'Encrypted filename copies',upload_attempts:'Upload attempts',unfinished_attempts:'Unfinished upload attempts',bank_transactions:'Normalized bank transactions',financial_records:'Financial records',classification_decisions:'Classification decisions',invoice_settlements:'Invoice settlements',tax_fact_sources:'Tax fact sources',merchant_evidence:'Merchant evidence links',fx_document_revisions:'Reviewed FX document revisions',bank_valuation_revisions:'Bank valuation revisions',tax_calculations:'Saved tax calculations',filing_packs:'Saved filing packs',finance_plan_revisions:'Saved finance plans'};
type Preview={preview_only:true;retained_material?:string;inventory_sha256:string;content_hashes:string[];counts:Record<string,number>;direct_references:Record<string,number>;owner_saved_material:Record<string,number>;tax_years:number[];documents:{id:string;file_hash:string;media_type:string;size_bytes:number}[];accounts:{id:string;label:string;masked_identifier:string}[]};
function Counts({values}:{values:Record<string,number>}){return <dl className="mt-3 grid grid-cols-2 gap-2">{Object.entries(values).map(([name,count])=><div key={name}><dt>{labels[name]??name}</dt><dd className="font-semibold">{count}</dd></div>)}</dl>}
export default async function EvidenceDeletionPreview({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user},error:authError}=await db.auth.getUser();if(authError||!user)redirect('/login');
 const params=await searchParams,kind=params.kind,id=params.id;
 let data:Preview|null=null;
 if((kind==='source'||kind==='document')&&typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)){
  const result=await db.rpc('review_evidence_deletion',{p_kind:kind,p_id:id});if(!result.error&&result.data?.preview_only===true)data=result.data as Preview;
 }
 return <main className="mx-auto max-w-4xl p-6" data-testid="evidence-deletion-preview">
  <Link href="/dashboard/imports" data-testid="deletion-back-to-imports">Back to imports</Link>
  <h1 className="mt-4 text-2xl font-semibold">Evidence deletion impact</h1>
  <p className="mt-3">Preview only. This page does not delete files or change financial records. Evidence is never deleted automatically.</p>
  {!data?<p role="alert" className="mt-6">The complete owned evidence scope could not be loaded. Return to Imports and choose the source again.</p>:<>
   {(data.counts.unresolved_upload_operations??0)>0?<p role="alert" className="mt-6" data-testid="deletion-upload-blocker">An upload is still running or its outcome is unknown. Deletion must wait until the upload outcome has been resolved.</p>:null}
   <section className="mt-6"><h2 className="text-xl font-semibold">Original copies in scope</h2><p>Shared ZIP archives and their other contents are included: deleting an extracted file alone would leave its bytes inside the archive. Identical statement copies can span several accounts.</p><Counts values={data.counts}/></section>
   <section className="mt-6"><h2 className="text-xl font-semibold">Linked records that must remain auditable</h2><Counts values={data.direct_references}/><p className="mt-3">These are direct links, not a complete inventory of every saved copy. Removing original evidence would not remove normalized transactions, decisions or financial history.</p></section>
   <section className="mt-6"><h2 className="text-xl font-semibold">Saved material requiring a further dependency check</h2><p>These totals cover your whole account. They are not counts of confirmed matches; saved bundles may contain evidence references and filenames.</p><Counts values={data.owner_saved_material}/></section>
   {data.tax_years.length?<p className="mt-4">Linked tax-year starts: {data.tax_years.join(', ')}</p>:null}
   {data.accounts.length?<ul aria-label="Affected accounts" className="mt-4">{data.accounts.map(a=><li key={a.id}>{a.label} — ending {a.masked_identifier}</li>)}</ul>:null}
   <details className="mt-6"><summary>Review content identities</summary><ul>{data.content_hashes.map(hash=><li key={hash} className="break-all text-xs">SHA-256: {hash}</li>)}</ul></details>
   {data.retained_material?<p className="mt-6" data-testid="deletion-retained-material">{data.retained_material}</p>:null}
   <p className="mt-6">Downloaded copies and backups are separate from active evidence storage. A deletion request must explain their treatment before it can be confirmed.</p>
   <p className="mt-3">Deletion is not available from this preview. No request has been created.</p>
  </>}
 </main>;
}
