'use client';
import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { currencyAmount, currencyCode, displayCurrencyAmount, FX_CURRENCIES, FX_CURRENCY_RULESET, fxRate } from '@/lib/fx/currency';
import { fxDocumentFactReadback, parseFxEvidenceCatalog, type FxConversionDocumentData, type FxDocumentFactIntent, type FxEvidenceCatalog, type FxInvoiceDocumentData } from '@/lib/fx/document-facts';
import { fxAmountReadback } from '@/lib/fx/readback';
import EvidenceDetails from './EvidenceDetails';
import { reviewFxEvidence } from './actions';
type Props={catalog:FxEvidenceCatalog;familyId:string;requestId:string;initialFamily?:string};
const control='block w-full rounded border p-2';
function Submit({enabled}:{enabled:boolean}){const {pending}=useFormStatus();return <button data-testid="fx-evidence-submit" disabled={!enabled||pending} className="rounded border p-3 font-semibold">{pending?'Saving evidence review…':'Save reviewed evidence facts'}</button>;}
export default function FxEvidenceReview(props:Props){return <ChooseFamily key={JSON.stringify(props)} {...props}/>;}
function ChooseFamily(props:Props){
    const [family,setFamily]=useState(props.initialFamily??''),[kind,setKind]=useState<'invoice'|'conversion'>('invoice');
    let catalog;try{catalog=parseFxEvidenceCatalog(props.catalog.owner_id,props.catalog);}catch{return <p role="alert" data-testid="fx-evidence-unavailable">Complete owned evidence context is unavailable. Reload before reviewing.</p>;}
    const current=catalog.facts.find(f=>f.family_id===family);
    return <section className="space-y-4">
        <label className="block">Evidence family
            <select data-testid="fx-evidence-family" className={control} value={family} onChange={e=>setFamily(e.target.value)}>
                <option value="">New evidence family</option>{catalog.facts.map(f=><option key={f.family_id} value={f.family_id}>{f.kind} · {f.state}{f.source_current?'':' · source stale'} · family {f.family_id}</option>)}
            </select>
        </label>
        {!current&&<label className="block">Document facts to prepare<select data-testid="fx-evidence-kind" className={control} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="invoice">Invoice original amount</option><option value="conversion">Conversion to recorded GBP cash</option></select></label>}
        <Draft key={(current?.family_id??'new')+':'+(current?.kind??kind)} {...props} catalog={catalog} current={current} kind={current?.kind??kind}/>
    </section>;
}
function Draft({catalog,familyId,requestId,current,kind}:{catalog:FxEvidenceCatalog;familyId:string;requestId:string;current?:FxEvidenceCatalog['facts'][number];kind:'invoice'|'conversion'}){
    const existingInvoice=current?.kind==='invoice'?current.data as FxInvoiceDocumentData:null,existingConversion=current?.kind==='conversion'?current.data as FxConversionDocumentData:null;
    const [state,setState]=useState<FxDocumentFactIntent['state']>('provisional'),[doc,setDoc]=useState(current?.document_id??''),[currency,setCurrency]=useState(existingInvoice?.currency??'USD');
    const [total,setTotal]=useState(existingInvoice?displayCurrencyAmount(existingInvoice.original_total_minor,existingInvoice.currency).split(' ')[1]:''),[invoiceDate,setInvoiceDate]=useState(existingInvoice?.invoice_date??''),[reference,setReference]=useState(existingInvoice?.invoice_reference??'');
    const [parentId,setParent]=useState(current?.invoice_evidence_revision_id??''),[receiptId,setReceipt]=useState(current?.transaction_id??''),[portion,setPortion]=useState(existingConversion?displayCurrencyAmount(existingConversion.invoice_portion_minor,existingConversion.rate.source_currency).split(' ')[1]:''),[cash,setCash]=useState(existingConversion?displayCurrencyAmount(existingConversion.gbp_cash_portion_pence,'GBP').split(' ')[1]:'');
    const [numerator,setNumerator]=useState(existingConversion?.rate.numerator??''),[denominator,setDenominator]=useState(existingConversion?.rate.denominator??''),[conversionDate,setConversionDate]=useState(existingConversion?.conversion_date??''),[evidenceDate,setEvidenceDate]=useState(existingConversion?.evidence_date??'');
    const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[attested,setAttested]=useState(false),[hash,setHash]=useState(''),[fileStatus,setFileStatus]=useState(''),generation=useRef(0);
    const reset=()=>{setConfirmed(false);setAttested(false);};
    const invalidateFile=()=>{generation.current++;setHash('');setFileStatus('');reset();};
    const document=catalog.documents.find(d=>d.id===doc),parent=catalog.facts.find(f=>f.id===parentId&&f.kind==='invoice'&&f.usable),receipt=catalog.receipts.find(r=>r.id===receiptId);
    async function checkLocalFile(file:File|undefined){
        const token=++generation.current;setHash('');reset();setFileStatus('');
        if(!file)return;
        if(!document || file.size<1 || file.size>3000000){setFileStatus('Choose the matching original, up to 3 MB.');return;}
        setFileStatus('Checking local file identity…');
        try{
            const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),value=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
            if(token!==generation.current)return;
            if(value!==document.source.document.file_sha256){setFileStatus('This copy does not match the retained original hash. Choose the original file.');return;}
            setHash(value);setFileStatus('Local copy matches the retained original hash. Read it in your trusted local viewer before attesting.');
        }catch{if(token===generation.current)setFileStatus('Could not check this local file. No facts were saved.');}
    }
    let preview:ReturnType<typeof fxDocumentFactReadback>|null=null,problem='';
    try{
        const withdrawing=state==='withdrawn';
        const data=withdrawing?null:kind==='invoice'?{currency,original_total_minor:currencyAmount(total,currency),invoice_date:invoiceDate,invoice_reference:reference}:
            {rate:fxRate({direction:'target_major_per_source_major',source_currency:(parent?.data as FxInvoiceDocumentData|undefined)?.currency,target_currency:'GBP',numerator,denominator}),conversion_date:conversionDate,evidence_date:evidenceDate,invoice_portion_minor:currencyAmount(portion,(parent?.data as FxInvoiceDocumentData|undefined)?.currency),gbp_cash_portion_pence:currencyAmount(cash,'GBP'),fee_mode:'none'};
        preview=fxDocumentFactReadback(catalog.owner_id,{schema_version:'fx-document-fact-intent/1',ruleset_id:FX_CURRENCY_RULESET,family_id:current?.family_id??familyId,expected_ordinal:current?.ordinal??0,kind,state,document_id:withdrawing?null:doc,invoice_evidence_revision_id:!withdrawing&&kind==='conversion'?parentId:null,transaction_id:!withdrawing&&kind==='conversion'?receiptId:null,transaction_version:!withdrawing&&kind==='conversion'?receipt?.decision_version:null,data,human_read_original:state==='verified',expected_stamp:catalog.stamp,rationale:reason.trim()||'Pending human evidence review',request_id:requestId},catalog);
    }catch(error){problem=error instanceof Error?error.message:'Review the exact evidence facts.';}
    const ready=!!preview&&!!reason.trim()&&(state!=='verified'||(attested&&hash===document?.source.document.file_sha256));
    const r=preview?.result,source=r?.retained_source?.document_source??r?.document,data=r?.retained_data??r?.data;
    const parentView=r?.retained_source?.invoice_evidence??(r?.invoice?{...r.invoice,data:r.invoice.data as FxInvoiceDocumentData}:null),receiptView=r?.retained_source?.receipt??r?.receipt;
    return <form action={reviewFxEvidence} data-testid="fx-evidence-review" className="space-y-5 rounded border p-4">
        <input data-testid="fx-evidence-intent" type="hidden" name="intent" value={ready?JSON.stringify(preview!.intent):''}/><input data-testid="fx-evidence-original-sha256" type="hidden" name="originalSha256" value={state==='verified'?hash:''}/>
        <h2 className="text-xl font-semibold">Draft {kind==='invoice'?'invoice':'conversion'} evidence facts</h2>
        {current&&<section className="space-y-2"><p data-testid="fx-evidence-current">Current revision {current.ordinal} · {current.id} · {current.state} · {current.source_current?'source current':'source stale'} · {current.usable?'eligible as evidence':'unavailable as current verified evidence'}. Your proposed revision below supersedes it; it does not restore older approvals.</p><details data-testid="fx-evidence-current-snapshot"><summary data-testid="fx-evidence-current-toggle">Retained facts from this revision</summary><p>Snapshot recorded then; current source eligibility is stated above.</p><EvidenceDetails source={current.source_snapshot.document_source} data={current.data} parent={current.source_snapshot.invoice_evidence} receipt={current.source_snapshot.receipt}/></details></section>}
        <label className="block">Proposed evidence state<select data-testid="fx-evidence-state" className={control} value={state} onChange={e=>{setState(e.target.value as typeof state);invalidateFile();}}><option value="provisional">Provisional — not verified</option><option value="verified">Verified — human read original</option>{current&&<option value="withdrawn">Withdrawn — retain earlier facts as history</option>}</select></label>
        {state!=='withdrawn'&&<>
            <label className="block">Preserved document<select data-testid="fx-evidence-document" className={control} value={doc} required onChange={e=>{setDoc(e.target.value);invalidateFile();}}><option value="">Choose preserved evidence</option>{catalog.documents.filter(d=>kind!=='invoice'||d.source.invoice_scope).map(d=><option key={d.id} value={d.id} disabled={!d.source.available}>{d.source.registration.purpose} · {d.source.registration.tax_year_start}/{String(d.source.registration.tax_year_start+1).slice(-2)} · {d.id}{d.source.available?'':' · unavailable'}</option>)}</select></label>
            {kind==='invoice'?<fieldset className="grid gap-3 sm:grid-cols-2"><legend>Invoice original</legend>
                <label>Currency<select className={control} data-testid="fx-evidence-currency" value={currency} onChange={e=>{setCurrency(currencyCode(e.target.value));reset();}}>{Object.keys(FX_CURRENCIES).map(c=><option key={c}>{c}</option>)}</select></label>
                <label>Original total ({currency})<input className={control} data-testid="fx-evidence-total" type="text" inputMode="decimal" maxLength={32} value={total} required onChange={e=>{setTotal(e.target.value);reset();}}/></label>
                <label>Invoice date<input className={control} data-testid="fx-evidence-invoice-date" type="date" value={invoiceDate} required onChange={e=>{setInvoiceDate(e.target.value);reset();}}/></label>
                <label>Invoice reference<input className={control} data-testid="fx-evidence-reference" maxLength={80} value={reference} required onChange={e=>{setReference(e.target.value);reset();}}/></label>
            </fieldset>:<fieldset className="grid gap-3 sm:grid-cols-2"><legend>Documented conversion</legend>
                <label>Verified invoice evidence<select className={control} data-testid="fx-evidence-parent" value={parentId} required onChange={e=>{setParent(e.target.value);reset();}}><option value="">Choose a current verified invoice revision</option>{catalog.facts.filter(f=>f.kind==='invoice'&&f.usable).map(f=><option key={f.id} value={f.id}>{(f.data as FxInvoiceDocumentData).invoice_reference} · revision {f.ordinal} · {f.id}</option>)}</select></label>
                <label>Recorded GBP receipt<select className={control} data-testid="fx-evidence-receipt" value={receiptId} required onChange={e=>{setReceipt(e.target.value);reset();}}><option value="">Choose the observed cash source</option>{catalog.receipts.filter(r=>r.import_status!=='discarded').map(r=><option key={r.id} value={r.id}>{r.transaction_date} · {displayCurrencyAmount(r.signed_amount_pence,'GBP')} · version {r.decision_version} · {r.id}</option>)}</select></label>
                <label>Invoice portion ({(parent?.data as FxInvoiceDocumentData|undefined)?.currency??'original currency'})<input className={control} data-testid="fx-evidence-portion" inputMode="decimal" maxLength={32} value={portion} required onChange={e=>{setPortion(e.target.value);reset();}}/></label>
                <label>Documented cash portion (GBP)<input className={control} data-testid="fx-evidence-cash" inputMode="decimal" maxLength={32} value={cash} required onChange={e=>{setCash(e.target.value);reset();}}/></label>
                <p className="sm:col-span-2">Enter the exact evidenced fraction: GBP major units for one original-currency major unit. For a rate of 0.79, enter numerator 79 and denominator 100. No rate is inferred.</p>
                <label>Rate numerator<input className={control} data-testid="fx-evidence-numerator" inputMode="numeric" maxLength={18} value={numerator} required onChange={e=>{setNumerator(e.target.value);reset();}}/></label>
                <label>Rate denominator<input className={control} data-testid="fx-evidence-denominator" inputMode="numeric" maxLength={18} value={denominator} required onChange={e=>{setDenominator(e.target.value);reset();}}/></label>
                <label>Conversion date<input className={control} data-testid="fx-evidence-conversion-date" type="date" value={conversionDate} required onChange={e=>{setConversionDate(e.target.value);reset();}}/></label>
                <label>Evidence date<input className={control} data-testid="fx-evidence-evidence-date" type="date" value={evidenceDate} required onChange={e=>{setEvidenceDate(e.target.value);reset();}}/></label>
            </fieldset>}
            {state==='verified'&&<fieldset className="space-y-3 rounded border p-3"><legend>Human original-document review</legend>
                <p>Read the original in your trusted local viewer. Select that same file to compare its hash here. Its contents and filename stay in this browser; this check does not test decryption of the retained object.</p>
                <label className="block">Local original for identity check<input key={doc+state} data-testid="fx-evidence-local-file" className={control} type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void checkLocalFile(file);}}/></label>
                <p role="status" data-testid="fx-evidence-file-status">{fileStatus||'No local copy checked.'}</p>
                <label className="block"><input data-testid="fx-evidence-original-read" type="checkbox" checked={attested} disabled={!hash} onChange={e=>{setAttested(e.target.checked);setConfirmed(false);}}/> I personally read this matching original and checked every proposed fact. A hash match alone does not verify its contents.</label>
            </fieldset>}
        </>}
        <label className="block">Reason for this evidence decision<input data-testid="fx-evidence-reason" className={control} value={reason} maxLength={1000} required onChange={e=>{setReason(e.target.value);reset();}}/></label>
        {preview&&source&&data?<section data-testid="fx-evidence-readback" aria-label="Read back proposed evidence" className="space-y-3 rounded border p-3"><h3 className="font-semibold">Review proposed {state} evidence · revision {(current?.ordinal??0)+1}</h3>
            {state==='withdrawn'&&<p>Withdraw the current fact. Retain its original source and facts below; live source is {current?.source_current?'current':'stale or unavailable'}. {kind==='invoice'?'Conversion facts pinned to this invoice revision become unavailable.':'This conversion family becomes unavailable as current verified evidence.'} No older verified revision is restored.</p>}
            <EvidenceDetails source={source} data={data} parent={parentView} receipt={receiptView}/>
            <p>New income: {fxAmountReadback(0,'GBP')}. New expenses: {fxAmountReadback(0,'GBP')}. No invoice created or finalised, payment matched, cash reserved or payment made. Amounts are evidence portions within the original invoice and observed cash, not remaining settlement capacities. Accounting classification needs its own review.</p>
        </section>:<p role="status" data-testid="fx-evidence-problem">{problem||'Choose and review all evidence facts.'}</p>}
        <label className="block"><input data-testid="fx-evidence-confirm" type="checkbox" name="humanConfirmed" value="yes" required checked={confirmed} disabled={!ready} onChange={e=>setConfirmed(e.target.checked)}/> I checked the exact read-back and confirm saving this evidence decision.</label>
        <Submit enabled={ready&&confirmed}/>
    </form>;
}
