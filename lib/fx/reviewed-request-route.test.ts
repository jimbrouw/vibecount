import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { fxReviewedFixture } from './reviewed-request-fixture';
async function harness(kind:'allocate'|'reverse'='allocate'){
 const x=fxReviewedFixture(kind),root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.fx-request-route-test-'));
 try{const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/reconciliation/fx/requests/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {prepareFxAllocation,prepareFxReversal,executeFxRequest,cancelFxRequest} from './app/dashboard/reconciliation/fx/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-request-boundaries',setup(b){
  b.onResolve({filter:/^server-only$|^(next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$|\.\/settlement-source-store$/},a=>({path:a.path.startsWith('next/')||a.path==='server-only'||a.path.endsWith('settlement-source-store')?a.path:'db',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='server-only'?'':a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}":a.path.endsWith('settlement-source-store')?`import {fixture} from 'test:db';export async function verifyOwnedSettlementSources(){fixture.calls.push('proof');if(fixture.proofFail)throw new Error('PRIVATE');return{outcome:fixture.proofUnavailable?'unavailable':'verified'}}`:`
export const fixture={owner:${JSON.stringify(x.owner)},intent:${JSON.stringify(x.intent)},raw:${JSON.stringify(x.raw)},catalog:${JSON.stringify(x.catalog)},portions:${JSON.stringify(x.portionReview)},result:${JSON.stringify(x.result)},signedIn:true,saved:false,historyFail:false,readFail:false,proofFail:false,proofUnavailable:false,prepareUncertain:false,commitUncertain:false,events:0,calls:[],filters:[]};
export async function createClient(){return{auth:{async getUser(){fixture.calls.push('auth');return{data:{user:fixture.signedIn?{id:fixture.owner}:null},error:null}}},from(table){if(table!=='fx_reviewed_requests')throw new Error('Unexpected history table');const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},async maybeSingle(){fixture.calls.push('history');fixture.filters.push(filters);if(filters.user_id!==fixture.owner)throw new Error('Missing owner');return{data:fixture.saved?{request_id:fixture.intent.request_id}:null,error:fixture.historyFail?{message:'PRIVATE'}:null}}};return q},async rpc(name,args){fixture.calls.push(name);
 if(name==='read_fx_settlement_catalog')return{data:fixture.catalog,error:fixture.readFail?{}:null};
 if(name==='read_fx_lot_portions')return{data:fixture.portions,error:fixture.readFail?{}:null};
 if(name==='read_fx_reviewed_requests')return{data:{schema_version:'fx-reviewed-request-index/1',owner_id:fixture.owner,pending_request_id:fixture.saved&&fixture.raw.state==='prepared'?fixture.intent.request_id:null,requests:fixture.saved?[{request_id:fixture.intent.request_id,kind:fixture.raw.request.kind,created_at:fixture.raw.request.created_at,state:fixture.raw.state}]:[]},error:fixture.readFail?{}:null};
 if(name==='prepare_fx_reviewed_request'){fixture.saved=true;return{data:fixture.raw.request,error:fixture.prepareUncertain?{message:'PRIVATE'}:null}}
 if(name==='read_fx_reviewed_request')return{data:fixture.saved?fixture.raw:null,error:!fixture.saved||fixture.readFail?{message:'PRIVATE'}:null};
 if(name==='commit_fx_reviewed_request'){if(fixture.raw.state==='cancelled')return{error:{message:'PRIVATE'}};if(fixture.raw.state!=='completed'){fixture.events++;fixture.raw.state='completed';fixture.raw.result=fixture.result;}return{data:fixture.result,error:fixture.commitUncertain?{message:'PRIVATE'}:null}}
 if(name==='cancel_fx_reviewed_request'){if(fixture.raw.state==='completed')return{error:{message:'PRIVATE'}};fixture.raw.state='cancelled';return{data:{state:'cancelled'},error:null}}
 throw new Error('Unexpected RPC '+name)
}}}
` }));
 }}]});const path=join(directory,'fixture.mjs');await writeFile(path,b.outputFiles[0].text);return await import(pathToFileURL(path).href);}finally{await rm(directory,{recursive:true,force:true})}
}
function prepareForm(intent:unknown){const f=new FormData();f.set('intent',JSON.stringify(intent));f.set('humanConfirmed','yes');return f}
function requestForm(request:string){const f=new FormData();f.set('requestId',request);f.set('humanConfirmed','yes');return f}
test('FX review preparation authenticates/bounds transport, persists before financial activity and retains identity on lost response',async()=>{
 for(const kind of ['allocate','reverse'] as const){const m=await harness(kind),f=m.fixture,action=kind==='allocate'?m.prepareFxAllocation:m.prepareFxReversal;
  f.signedIn=false;await assert.rejects(action(prepareForm(f.intent)),/login/);f.signedIn=true;
  for(const mutate of [(form:FormData)=>form.delete('humanConfirmed'),(form:FormData)=>form.append('intent','{}'),(form:FormData)=>form.set('private','PRIVATE'),(form:FormData)=>form.set('intent','x'.repeat(128001))]){f.calls=[];const bad=prepareForm(f.intent);mutate(bad);await assert.rejects(action(bad),/error=review/);assert.deepEqual(f.calls,['auth']);}
  f.calls=[];f.prepareUncertain=true;await assert.rejects(action(prepareForm(f.intent)),new RegExp('request='+f.intent.request_id+'&notice=prepare-check'));
  assert.ok(!f.calls.includes('proof'));assert.ok(!f.calls.includes('commit_fx_reviewed_request'));assert.equal(f.events,0);assert.ok(f.filters.every((v:{user_id:string})=>v.user_id===f.owner));
  f.prepareUncertain=false;f.calls=[];await assert.rejects(action(prepareForm(f.intent)),new RegExp('request='+f.intent.request_id+'$'));assert.deepEqual(f.calls,['auth','history','prepare_fx_reviewed_request','read_fx_reviewed_request']);
  const html=await m.render({request:f.intent.request_id});assert.match(html,/awaiting financial confirmation/);assert.match(html,/fx-request-execute/);assert.match(html,/fx-request-cancel/);
 }
});
test('uncertain financial response refreshes to exact saved result; completed recovery skips mutable sources and no retry duplicates events',async()=>{
 for(const kind of ['allocate','reverse'] as const){const m=await harness(kind),f=m.fixture;f.saved=true;f.commitUncertain=true;f.calls=[];
  await assert.rejects(m.executeFxRequest(requestForm(f.intent.request_id)),/notice=financial-check/);assert.equal(f.events,1);
  assert.equal(f.calls.includes('proof'),kind==='allocate');assert.equal(f.calls[1],'read_fx_reviewed_request');assert.equal(f.calls.at(-1),'commit_fx_reviewed_request');
  const html=await m.render({request:f.intent.request_id,notice:'financial-check'});assert.match(html,/fx-request-completed/);assert.doesNotMatch(html,/data-testid="fx-request-execute"/);
  f.commitUncertain=false;f.proofFail=true;f.catalog=null;f.calls=[];await assert.rejects(m.executeFxRequest(requestForm(f.intent.request_id)),new RegExp('request='+f.intent.request_id+'$'));assert.deepEqual(f.calls,['auth','read_fx_reviewed_request','commit_fx_reviewed_request']);assert.equal(f.events,1);
  f.calls=[];await assert.rejects(m.cancelFxRequest(requestForm(f.intent.request_id)),/notice=cancel-check/);assert.equal(f.raw.state,'completed');
 }
});
test('failed history/source/proof and malformed final transport never reaches financial writer; cancellation remains separate',async()=>{
 const m=await harness(),f=m.fixture;f.saved=true;
 for(const flag of ['readFail','proofFail','proofUnavailable']){f[flag]=true;f.calls=[];await assert.rejects(m.executeFxRequest(requestForm(f.intent.request_id)),/notice=financial-check/);assert.ok(!f.calls.includes('commit_fx_reviewed_request'));assert.equal(f.events,0);f[flag]=false;}
 for(const mutate of [(form:FormData)=>form.delete('humanConfirmed'),(form:FormData)=>form.set('requestId','bad'),(form:FormData)=>form.append('requestId',f.intent.request_id),(form:FormData)=>form.set('intent','PRIVATE')]){f.calls=[];const bad=requestForm(f.intent.request_id);mutate(bad);await assert.rejects(m.executeFxRequest(bad),/notice=review/);assert.deepEqual(f.calls,['auth']);}
 f.calls=[];f.proofFail=true;await assert.rejects(m.cancelFxRequest(requestForm(f.intent.request_id)),new RegExp('request='+f.intent.request_id+'$'));assert.deepEqual(f.calls,['auth','cancel_fx_reviewed_request']);assert.equal(f.events,0);
 const html=await m.render({request:f.intent.request_id});assert.match(html,/fx-request-cancelled/);assert.doesNotMatch(html,/data-testid="fx-request-execute"/);
 f.saved=false;const absent=await m.render({request:f.intent.request_id,notice:'prepare-check'});assert.match(absent,/No financial action was attempted/);assert.match(absent,/fx-request-unavailable/);assert.doesNotMatch(absent,/fx-request-completed/);
});
