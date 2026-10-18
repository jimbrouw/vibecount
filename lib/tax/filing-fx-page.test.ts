import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { filingFxFixture } from './filing-fx-fixture';
import { buildFilingPack, buildFilingReview } from './filing-pack';
import { canonicalJson,sha256 } from './snapshot';
test('current and retained filing V4 pages keep currency blockers visible and show complete FX provenance counts',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),input=filingFxFixture(),bundle=buildFilingPack(input,[],'request',false),model=buildFilingReview(input,[]),id='11111111-1111-4111-8111-111111111111';
 const row={id,tax_year_start:2025,input,input_canonical_json:canonicalJson(input),input_sha256:bundle.input_sha256,bundle,bundle_canonical_json:canonicalJson(bundle),bundle_sha256:sha256(canonicalJson(bundle)),reason:'Synthetic',author:input.owner_id,created_at:'2026-10-18',request_id:'request'};
 const directory=await mkdtemp(join(root,'.filing-fx-page-test-'));
 try{
  const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','react-dom'],stdin:{resolveDir:root,contents:"import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/tax-prep/filing-pack/page.tsx';export async function render(params){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {fixture} from 'test:db';"},plugins:[{name:'inert-filing-page',setup(b){
   b.onResolve({filter:/^(next\/(navigation|link)|@\/lib\/supabase\/server|@\/lib\/tax\/filing-server|test:db|\.\/FilingReview)$/},a=>({path:a.path.startsWith('next/')||a.path==='./FilingReview'?a.path:'db',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',resolveDir:root,contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}":a.path==='./FilingReview'?"export function FilingStepForm(){return null}export function FilingPackCapture(){return null}":`
export const fixture={signedIn:true,input:${JSON.stringify(input)},model:${JSON.stringify(model)},row:${JSON.stringify(row)}};
export async function loadFilingContext(){return{input:fixture.input,model:fixture.model,history:[]}}
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${input.owner_id}'}:null},error:null})},from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},single(){return Promise.resolve({data:fixture.row,error:null})},maybeSingle(){return Promise.resolve({data:{id:fixture.input.calculation.id},error:null})},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}}}` }));
  }}]});
  const path=join(directory,'fixture.mjs');await writeFile(path,b.outputFiles[0].text);const m=await import(pathToFileURL(path).href);
  m.fixture.signedIn=false;await assert.rejects(m.render({year:'2025'}),/REDIRECT:\/login/);m.fixture.signedIn=true;
  for(const params of [{year:'2025'},{year:'2025',saved:id}]){
   const html=await m.render(params);assert.match(html,/filing-fx-provenance/);assert.match(html,/3 allocation and reversal events/);assert.match(html,/Unsupported currency tax treatment remains unresolved/);assert.match(html,/Invoice currency coverage/);assert.doesNotMatch(html,/Historical pack inputs predate|PRIVATE|object_path/);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
