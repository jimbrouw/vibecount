'use client';
import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { bankValuationReadback, parseBankValuationReview, type BankValuationReview as Context } from '@/lib/records/bank-valuation-review';
import { FX_CURRENCY_RULESET, fxRate } from '@/lib/fx/currency';
import { fxAmountReadback, fxRateReadback } from '@/lib/fx/readback';
import { reviewBankValuation } from './actions';
const control='block w-full rounded border p-2';
function Submit({enabled}:{enabled:boolean}){
  const {pending}=useFormStatus();return <button data-testid="bank-valuation-submit" disabled={!enabled||pending} className="rounded border p-3">{pending?'Saving valuation review…':'Save valuation review'}</button>;
}
export default function BankValuationReview(props:{context:Context;requestId:string}){
  let context;try{context=parseBankValuationReview(props.context.owner_id,props.context);}catch{return <p role="alert">Complete valuation review is unavailable.</p>;}
  return <Draft key={JSON.stringify(props)} context={context} requestId={props.requestId}/>;
}
function Draft({context:c,requestId}:{context:Context;requestId:string}){
  const [state,setState]=useState<'provisional'|'reviewed'|'withdrawn'>('provisional');
  const [documentId,setDocument]=useState(c.head?.document_id??''),[numerator,setNumerator]=useState(c.head?.data.rate.numerator??''),[denominator,setDenominator]=useState(c.head?.data.rate.denominator??'');
  const [valuationDate,setValuationDate]=useState(c.head?.data.valuation_date??''),[evidenceDate,setEvidenceDate]=useState(c.head?.data.evidence_date??'');
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[attested,setAttested]=useState(false),[hash,setHash]=useState(''),[fileStatus,setFileStatus]=useState('');
  const generation=useRef(0),document=c.documents.find(d=>d.document.id===documentId);
  function reset(){setConfirmed(false);setAttested(false);}
  function resetFile(){generation.current++;setHash('');setFileStatus('');reset();}
  async function checkFile(file?:File){
    const token=++generation.current;setHash('');reset();setFileStatus('');if(!file)return;
    if(!document||file.size!==document.document.size_bytes||file.size>3000000){setFileStatus('Choose the matching preserved original, up to 3 MB.');return;}
    setFileStatus('Checking local original identity…');
    try{
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),value=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if(token!==generation.current)return;
      if(value!==document.document.file_sha256){setFileStatus('This file does not match the preserved original.');return;}
      setHash(value);setFileStatus('Original hash matches. Read the document in your trusted local viewer before confirming its facts.');
    }catch{if(token===generation.current)setFileStatus('Original identity could not be checked.');}
  }
  let preview:ReturnType<typeof bankValuationReadback>|null=null,problem='';
  try{
    preview=bankValuationReadback(c.owner_id,{schema_version:'bank-valuation-intent/1',ruleset_id:FX_CURRENCY_RULESET,
      transaction_id:c.transaction.id,transaction_version:state==='withdrawn'?null:c.transaction.decision_version,expected_ordinal:c.head?.ordinal??0,state,
      document_id:state==='withdrawn'?null:documentId,data:state==='withdrawn'?null:{method:'documented_rate/1',rate:fxRate({direction:'target_major_per_source_major',source_currency:c.transaction.currency,target_currency:'GBP',numerator,denominator}),valuation_date:valuationDate,evidence_date:evidenceDate},
      human_read_original:state==='reviewed',expected_stamp:c.stamp,rationale:reason.trim()||'Pending human valuation review',request_id:requestId},c);
  }catch(error){problem=error instanceof Error?error.message:'Review the exact source and documented rate.';}
  const ready=!!preview&&!!reason.trim()&&(state!=='reviewed'||(attested&&hash===document?.document.file_sha256));
  return <form action={reviewBankValuation} data-testid="bank-valuation-form" className="space-y-4 rounded border p-4">
    <input type="hidden" name="intent" data-testid="bank-valuation-intent" value={ready?JSON.stringify(preview!.intent):''}/>
    <input type="hidden" name="originalSha256" value={state==='reviewed'?hash:''}/>
    <h2 className="text-xl font-semibold">Draft valuation revision {(c.head?.ordinal??0)+1}</h2>
    <p>Original observation: {fxAmountReadback(c.transaction.original_signed_minor,c.transaction.currency)}.</p>
    {c.head&&<p data-testid="bank-valuation-current">Current revision {c.head.ordinal}: {c.head.state}; {c.head_current?'source current':'source stale or not reviewed'}. Retained GBP valuation: {fxAmountReadback(c.head.signed_gbp_pence,'GBP')}. A new revision preserves this history.</p>}
    {!c.can_change&&<p role="alert">Review and reverse dependent financial effects before changing this valuation.</p>}
    <label className="block">Proposed state<select className={control} data-testid="bank-valuation-state" value={state} onChange={e=>{setState(e.target.value as typeof state);resetFile();}}>
      <option value="provisional">Provisional — needs review</option><option value="reviewed">Reviewed — human checked original</option>{c.head&&<option value="withdrawn">Withdrawn — retain history</option>}
    </select></label>
    {state!=='withdrawn'&&<>
      <label className="block">Preserved rate evidence<select className={control} data-testid="bank-valuation-document" value={documentId} onChange={e=>{setDocument(e.target.value);resetFile();}} required>
        <option value="">Choose preserved evidence</option>{c.documents.map(d=><option key={d.document.id} value={d.document.id} disabled={!d.available}>{d.registration.purpose} · {d.registration.tax_year_start} · {d.document.id}{d.available?'':' · unavailable'}</option>)}
      </select></label>
      <p>Enter the evidenced fraction in GBP per one {c.transaction.currency}. For 0.79, enter 79 divided by 100.</p>
      <label className="block">Rate numerator<input className={control} data-testid="bank-valuation-numerator" inputMode="numeric" maxLength={18} value={numerator} required onChange={e=>{setNumerator(e.target.value);reset();}}/></label>
      <label className="block">Rate denominator<input className={control} data-testid="bank-valuation-denominator" inputMode="numeric" maxLength={18} value={denominator} required onChange={e=>{setDenominator(e.target.value);reset();}}/></label>
      <label className="block">Valuation date<input className={control} data-testid="bank-valuation-date" type="date" value={valuationDate} required onChange={e=>{setValuationDate(e.target.value);reset();}}/></label>
      <label className="block">Evidence date<input className={control} data-testid="bank-valuation-evidence-date" type="date" value={evidenceDate} required onChange={e=>{setEvidenceDate(e.target.value);reset();}}/></label>
      {state==='reviewed'&&<fieldset className="space-y-3 rounded border p-3"><legend>Read the original evidence</legend>
        <p>Use your trusted local viewer to read the document. Selecting it here only checks its hash; file contents and name are not uploaded.</p>
        <label className="block">Matching local original<input key={documentId} className={control} data-testid="bank-valuation-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void checkFile(f);}}/></label>
        <p role="status" data-testid="bank-valuation-file-status">{fileStatus||'No local original checked.'}</p>
        <label><input data-testid="bank-valuation-attested" type="checkbox" checked={attested} disabled={!hash} onChange={e=>{setAttested(e.target.checked);setConfirmed(false);}}/> I read the matching original and checked the rate, direction and dates.</label>
      </fieldset>}
    </>}
    <label className="block">Reason for this valuation decision<input className={control} data-testid="bank-valuation-reason" value={reason} maxLength={1000} required onChange={e=>{setReason(e.target.value);reset();}}/></label>
    {preview?<section data-testid="bank-valuation-readback" className="space-y-2 rounded border p-3" aria-label="Valuation read-back">
      <h3 className="font-semibold">Review proposed {state} valuation</h3>
      {state==='withdrawn'&&<p>Withdraw this valuation. Earlier revisions remain history and are not restored as current approvals.</p>}
      <p>Original: {fxAmountReadback(preview.source.original_signed_minor,preview.source.currency)} on {preview.source.cash_date}. Source row {preview.source.row_number}.</p>
      <p>Rate: {fxRateReadback(preview.data.rate)}. Method: documented rate. Valuation date: {preview.data.valuation_date}; evidence date: {preview.data.evidence_date}.</p>
      <p>GBP valuation: {fxAmountReadback(preview.conversion.target_minor,'GBP')}. Rounded to the nearest penny; exact half-pennies round away from zero.</p>
      {preview.conversion.target_minor===0&&<p>The nonzero original rounds to GBP zero. The original remains visible and no positive accounting amount is invented.</p>}
      <p className="break-all">Statement SHA-256: {preview.source.file_sha256}. Row SHA-256: {preview.source.row_sha256}. Evidence SHA-256: {preview.document.document.file_sha256}.</p>
      <details><summary data-testid="bank-valuation-trace">Exact rounding trace</summary><pre className="overflow-auto">{JSON.stringify(preview.conversion,null,2)}</pre></details>
      <p>New approved income: {fxAmountReadback(0,'GBP')}. New approved expenses: {fxAmountReadback(0,'GBP')}. Classification and tax treatment need a separate human decision.</p>
    </section>:<p role="status" data-testid="bank-valuation-problem">{problem}</p>}
    <label className="block"><input data-testid="bank-valuation-confirm" type="checkbox" name="humanConfirmed" value="yes" required checked={confirmed} disabled={!ready} onChange={e=>setConfirmed(e.target.checked)}/> I checked this read-back and confirm saving the valuation revision.</label>
    <Submit enabled={ready&&confirmed}/>
  </form>;
}
