'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { foreignClassificationReadback,parseForeignClassificationReview,type ForeignClassificationReview as Context } from '@/lib/records/foreign-classification-review';
import { FOREIGN_SHARE_POLICY } from '@/lib/records/foreign-classification';
import { fxAmountReadback } from '@/lib/fx/readback';
import { confirmForeignClassification } from './actions';
const control='block w-full rounded border p-2';
function Submit({enabled}:{enabled:boolean}){const {pending}=useFormStatus();return <button data-testid="foreign-classification-submit" disabled={!enabled||pending} className="rounded border p-3">{pending?'Saving classification…':'Confirm classification'}</button>;}
export default function ForeignClassificationReview(props:{context:Context;requestId:string}){
 let context;try{context=parseForeignClassificationReview(props.context.valuation.owner_id,props.context);}catch{return <p role="alert">Complete classification review is unavailable.</p>;}
 return <Draft key={JSON.stringify(props)} context={context} requestId={props.requestId}/>;
}
function Draft({context:c,requestId}:{context:Context;requestId:string}){
 const [classification,setClassification]=useState(['Business','Mixed','Personal','Unknown'].includes(c.current.classification)?c.current.classification:'Unknown');
 const [category,setCategory]=useState(c.current.category_id??''),[percent,setPercent]=useState(c.current.business_use_bps>0?String(c.current.business_use_bps/100):'');
 const [reason,setReason]=useState(''),[treatment,setTreatment]=useState(false),[confirmed,setConfirmed]=useState(false);
 const included=['Business','Mixed'].includes(classification),tx=c.valuation.transaction,kind=tx.original_signed_minor>0?'income':'expense';
 function reset(){setTreatment(false);setConfirmed(false);}
 let preview:ReturnType<typeof foreignClassificationReadback>|null=null,problem='';
 try{
  const [whole,fraction='']=percent.split('.');
  const bps=classification==='Business'?10000:classification==='Mixed'&&/^\d{1,2}(\.\d{1,2})?$/.test(percent)?Number(whole)*100+Number(fraction.padEnd(2,'0')):0;
  preview=foreignClassificationReadback(c.valuation.owner_id,{schema_version:'foreign-classification-intent/1',transaction_id:tx.id,transaction_version:tx.decision_version,
   valuation_revision_id:included?c.valuation.head?.id??null:null,classification,category_id:included?category:null,business_use_bps:bps,rounding_policy:FOREIGN_SHARE_POLICY,
   treatment_reviewed:included,expected_stamp:c.stamp,rationale:reason.trim()||'Pending human classification review',request_id:requestId,human_confirmed:true},c);
 }catch(error){problem=error instanceof Error?error.message:'Review the current classification.';}
 const ready=!!preview&&!!reason.trim()&&(!included||treatment);
 return <form action={confirmForeignClassification} data-testid="foreign-classification-form" className="space-y-4 rounded border p-4">
  <input type="hidden" name="intent" data-testid="foreign-classification-intent" value={ready?JSON.stringify(preview!.intent):''}/>
  <h2 className="text-xl font-semibold">Draft classification decision</h2>
  <p>Original observation: {fxAmountReadback(tx.original_signed_minor,tx.currency)}. Current classification: {c.current.classification}. Current approved {kind}: {fxAmountReadback(c.current.recognized_pence,'GBP')}.</p>
  {!c.can_classify&&<p role="alert">Reopen the import or reverse dependent financial relationships before changing this classification.</p>}
  <label className="block">Proposed classification<select className={control} data-testid="foreign-classification-choice" value={classification} onChange={e=>{setClassification(e.target.value);reset();}}>
   <option value="Unknown">Unknown — unresolved, no approved amount</option><option value="Personal">Personal — excluded</option><option value="Business">Business</option>{kind==='expense'&&<option value="Mixed">Mixed business and personal</option>}
  </select></label>
  {included&&<>
   <label className="block">Accounting category<select className={control} data-testid="foreign-classification-category" value={category} required onChange={e=>{setCategory(e.target.value);reset();}}><option value="">Choose a category</option>{c.categories.filter(r=>r.record_type===kind).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
   {classification==='Mixed'&&<label className="block">Business-use percentage<input className={control} data-testid="foreign-classification-percent" inputMode="decimal" maxLength={5} value={percent} required onChange={e=>{setPercent(e.target.value);reset();}}/></label>}
  </>}
  <label className="block">Reason and evidence for this decision<input className={control} data-testid="foreign-classification-reason" value={reason} maxLength={1000} required onChange={e=>{setReason(e.target.value);reset();}}/></label>
  {preview?<section data-testid="foreign-classification-readback" aria-label="Classification read-back" className="space-y-2 rounded border p-3">
   <h3 className="font-semibold">Review proposed {classification}</h3>
   {preview.valuation&&<><p>Reviewed valuation revision {preview.valuation.ordinal}: {fxAmountReadback(preview.valuation.signed_gbp_pence,'GBP')}. Valuation date {preview.valuation.data.valuation_date}; cash date {preview.valuation.source_snapshot.economic_source.cash_date}.</p>
    <p>Business share: {preview.intent.business_use_bps/100}%. Category: {preview.category?.name}. Apply this share to the rounded GBP valuation, then round to the nearest penny, half up.</p>
    <p className="break-all">Valuation ID: {preview.valuation.id}. Original file SHA-256: {preview.valuation.source_snapshot.economic_source.file_sha256}.</p></>}
   <p>Current approved {kind}: {fxAmountReadback(preview.previous_pence,'GBP')}. Proposed approved {kind}: {fxAmountReadback(preview.recognized_pence,'GBP')}. Change: {fxAmountReadback(preview.change_pence,'GBP')}.</p>
   {included&&preview.recognized_pence===0&&<p>The reviewed amount rounds to zero. The original and decision remain visible without creating a positive posting.</p>}
   {!included&&<p>The approved accounting amount becomes zero. Existing records remain in history. {classification==='Unknown'?'This observation remains unresolved.':'This observation is excluded as personal.'}</p>}
   <p>This decision does not submit a tax return or make a payment. Tax estimates and filing preparation still require their own completeness review.</p>
  </section>:<p role="status" data-testid="foreign-classification-problem">{problem}</p>}
  {included&&<label className="block"><input data-testid="foreign-classification-treatment" type="checkbox" checked={treatment} onChange={e=>{setTreatment(e.target.checked);setConfirmed(false);}}/> I reviewed the accounting treatment, category, date and business-use share against the evidence. The exchange rate alone does not establish business or tax eligibility.</label>}
  <label className="block"><input data-testid="foreign-classification-confirm" name="humanConfirmed" value="yes" type="checkbox" required checked={confirmed} disabled={!ready} onChange={e=>setConfirmed(e.target.checked)}/> I checked the original amount, valuation and exact accounting change and confirm this decision.</label>
  <Submit enabled={ready&&confirmed}/>
 </form>;
}
