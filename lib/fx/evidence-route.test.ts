import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { fxDocumentFactsFixture } from './document-facts-fixture';
import { validateFxDocumentFactIntent } from './document-facts';
async function fixture(){
    const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.fx-evidence-route-test-')),f=fxDocumentFactsFixture();
    try{
        const bundled=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/reconciliation/fx/evidence/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {reviewFxEvidence} from './app/dashboard/reconciliation/fx/evidence/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-evidence-boundaries',setup(b){
            b.onResolve({filter:/source-actions$/},()=>({path:'source-action',namespace:'fixture'}));
            b.onResolve({filter:/^(next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path.startsWith('next/')?a.path:'test:db',namespace:'fixture'}));
            b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='source-action'?'export async function checkInvoiceRetainedSource(){}':a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(path){ }':a.path==='next/link'?"import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children)}":`
export const fixture={signedIn:true,catalog:${JSON.stringify(f.catalog)},calls:[],queries:[],prior:false,history:[],historyFail:false,readFail:false,writeFail:false,invalidResult:false,stampChanged:false,stampFail:false};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${f.owner}'}:null},error:null})},from(name){const q={select(){return q},eq(k,v){fixture.queries.push([name,k,v]);return q},order(){return q},limit(){return q},gt(k,v){fixture.queries.push([name,k,v]);return q},async maybeSingle(){return{data:fixture.prior?{request_id:'saved'}:null,error:fixture.historyFail?{message:'PRIVATE'}:null}},then(ok,fail){return Promise.resolve({data:name==='invoice_source_read_checks'?[]:fixture.history,error:fixture.historyFail?{message:'PRIVATE'}:null}).then(ok,fail)}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});const i=args?.p_intent;return{data:name==='read_fx_evidence_catalog'?fixture.catalog:name==='fx_evidence_review_stamp'?(fixture.stampChanged?'0'.repeat(32):fixture.catalog.stamp):fixture.invalidResult?null:{family_id:i.family_id,revision_id:'00000000-0000-4000-8000-000000000090',ordinal:i.expected_ordinal+1,state:i.state,kind:i.kind,financial_action:'evidence_preparation_only',recognized_income_change_pence:0,recognized_expense_change_pence:0,canonical_invoice_change:0,settlement_change:0},error:(name==='read_fx_evidence_catalog'?fixture.readFail:name==='fx_evidence_review_stamp'?fixture.stampFail:fixture.writeFail)?{message:'PRIVATE_DATABASE_DETAIL'}:null}}}}` }));
        }}]});const path=join(dir,'fixture.mjs');await writeFile(path,bundled.outputFiles[0].text);return await import(pathToFileURL(path).href);
    }finally{await rm(dir,{recursive:true,force:true});}
}
function form(intent:unknown=fxDocumentFactsFixture().intent,hash=fxDocumentFactsFixture().source.document.file_sha256){const f=new FormData();f.set('intent',JSON.stringify(intent));f.set('humanConfirmed','yes');f.set('originalSha256',hash);return f;}
test('FX action authenticates and rejects malformed, duplicate, extra and file transport before writes',async()=>{
    const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.reviewFxEvidence(form()),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
    for(const intent of [null,{}, {...fxDocumentFactsFixture().intent,owner:'foreign'},{...fxDocumentFactsFixture().intent,human_read_original:false}])await assert.rejects(m.reviewFxEvidence(form(intent)),/error=review/);
    for(const mutate of [(x:FormData)=>x.delete('humanConfirmed'),(x:FormData)=>x.append('intent','{}'),(x:FormData)=>x.append('originalSha256',''),(x:FormData)=>x.set('originalSha256','bad'),(x:FormData)=>x.set('intent','x'.repeat(16001)),(x:FormData)=>x.set('raw_file',new Blob(['PRIVATE']),'PRIVATE.pdf'),(x:FormData)=>x.set('owner','foreign')]){const bad=form();mutate(bad);await assert.rejects(m.reviewFxEvidence(bad),/error=review/);}
    assert.equal(f.calls.length,0);assert.equal(f.queries.length,0);
    await assert.rejects(m.reviewFxEvidence(form()),/result=saved/);assert.deepEqual(f.calls.map((c:{name:string})=>c.name),['read_fx_evidence_catalog','review_fx_document_evidence']);
    const framework=form();framework.set('$ACTION_ID_reserved','framework metadata');await assert.rejects(m.reviewFxEvidence(framework),/result=saved/);
    assert.deepEqual(f.calls[1].args,{p_intent:validateFxDocumentFactIntent(fxDocumentFactsFixture().intent)});assert.ok(f.queries.some((q:string[])=>q[1]==='user_id'&&q[2]===fxDocumentFactsFixture().owner));
});
test('FX action recomputes owned sources, requires matching hash for verification and withholds failures',async()=>{
    const m=await fixture(),f=m.fixture,base=fxDocumentFactsFixture();
    f.historyFail=true;await assert.rejects(m.reviewFxEvidence(form()),/error=history/);assert.equal(f.calls.length,0);f.historyFail=false;
    for(const hash of ['', 'c'.repeat(64)])await assert.rejects(m.reviewFxEvidence(form(base.intent,hash)),/error=sources/);
    f.readFail=true;await assert.rejects(m.reviewFxEvidence(form()),/error=sources/);f.readFail=false;
    f.catalog.stamp='0'.repeat(32);await assert.rejects(m.reviewFxEvidence(form()),/error=sources/);
    f.catalog=fxDocumentFactsFixture().catalog;f.catalog.owner_id='00000000-0000-4000-8000-000000000099';await assert.rejects(m.reviewFxEvidence(form()),/error=sources/);
    assert.equal(f.calls.filter((c:{name:string})=>c.name==='review_fx_document_evidence').length,0);
    f.catalog=fxDocumentFactsFixture().catalog;f.writeFail=true;await assert.rejects(m.reviewFxEvidence(form()),e=>{assert.match((e as Error).message,/error=save/);assert.ok(!(e as Error).message.includes('PRIVATE'));return true;});
    f.writeFail=false;f.invalidResult=true;await assert.rejects(m.reviewFxEvidence(form()),/error=save/);
});
test('provisional and withdrawal need no local file; exact retries still reach SQL without live reads',async()=>{
    const m=await fixture(),f=m.fixture,base=fxDocumentFactsFixture();
    await assert.rejects(m.reviewFxEvidence(form({...base.intent,state:'provisional',human_read_original:false},'')),/result=saved/);
    f.catalog.facts=[{...base.invoice,source_current:false,usable:false}];f.catalog.counts.facts=1;f.catalog.documents[0].source.available=false;
    const undo={...base.intent,expected_ordinal:1,state:'withdrawn',document_id:null,data:null,human_read_original:false};await assert.rejects(m.reviewFxEvidence(form(undo,'')),/result=saved/);
    f.calls=[];f.prior=true;f.readFail=true;f.catalog=null;
    await assert.rejects(m.reviewFxEvidence(form(base.intent,'')),/result=saved/);assert.deepEqual(f.calls,[{name:'review_fx_document_evidence',args:{p_intent:validateFxDocumentFactIntent(base.intent)}}]);
    f.writeFail=true;await assert.rejects(m.reviewFxEvidence(form({...base.intent,rationale:'Changed retained request'},'')),/error=save/);assert.equal(f.calls.at(-1).args.p_intent.expected_stamp,base.intent.expected_stamp);
});
test('FX page keeps latest eligibility separate from paged immutable history and withholds unsafe context',async()=>{
    const m=await fixture(),f=m.fixture,base=fxDocumentFactsFixture();f.signedIn=false;await assert.rejects(m.render(),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
    let html=await m.render();assert.match(html,/fx-evidence-review/);assert.match(html,/Provisional — not verified/);assert.match(html,/disabled/);assert.ok(!html.includes('PRIVATE'));
    for(const params of [{family:'bad'},{family:'00000000-0000-4000-8000-000000000099'},{after:['bad']}])assert.match(await m.render(params),/fx-evidence-unavailable/);
    f.catalog.facts=[base.invoice];f.catalog.counts.facts=1;
    f.history=Array.from({length:21},(_,i)=>({...base.invoice,id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,user_id:base.owner,author:base.owner,created_at:'2026-10-17T10:00:00+00:00',rationale:'Human reviewed original'}));
    html=await m.render({family:base.invoice.family_id});assert.match(html,/fx-evidence-history-next/);assert.equal((html.match(/data-testid="fx-evidence-history-000/g)||[]).length,20);assert.match(html,/one thousand US dollars/);assert.match(html,/Historical snapshots/);
    await m.render({after:f.history[19].id});assert.ok(f.queries.some((q:string[])=>q[1]==='id'&&q[2]===f.history[19].id));
    f.history[0].author='00000000-0000-4000-8000-000000000099';assert.match(await m.render(),/fx-evidence-unavailable/);f.history=[];f.historyFail=true;assert.match(await m.render(),/fx-evidence-unavailable/);f.historyFail=false;f.readFail=true;assert.match(await m.render(),/fx-evidence-unavailable/);
    f.readFail=false;f.stampChanged=true;assert.match(await m.render(),/fx-evidence-unavailable/);f.stampChanged=false;f.stampFail=true;assert.match(await m.render(),/fx-evidence-unavailable/);f.stampFail=false;
    f.readFail=false;f.catalog.counts.documents=0;assert.match(await m.render(),/fx-evidence-unavailable/);
});
