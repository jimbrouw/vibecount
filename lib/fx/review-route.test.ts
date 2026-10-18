import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fxHistoryFixture } from './history-fixture';
import { fxAuthoritativeReviewFixture } from './review-fixture';
import { fxFixtureId as id } from './fixture';
async function fixture(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.fx-review-route-test-'));
 try{const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','react-dom'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Match from './app/dashboard/reconciliation/fx/page.tsx';import Reversal from './app/dashboard/reconciliation/fx/reversal/page.tsx';export async function match(params={}){return renderToStaticMarkup(await Match({searchParams:Promise.resolve(params)}))}export async function reversal(params={}){return renderToStaticMarkup(await Reversal({searchParams:Promise.resolve(params)}))}export {fixture} from 'test:db';`},plugins:[{name:'inert-review-boundaries',setup(b){
  b.onResolve({filter:/^(server-only|next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path==='server-only'||a.path.startsWith('next/')?a.path:'test:db',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',resolveDir:root,contents:a.path==='server-only'?'':a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}":`export const fixture={signedIn:true,fail:false,failRpc:'',pending:null,context:${JSON.stringify(fxAuthoritativeReviewFixture(true))},portions:${JSON.stringify(fxHistoryFixture().activeReview())},calls:[]};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${id(1)}'}:null},error:null})},rpc:async(name)=>{fixture.calls.push(name);return{data:name==='read_fx_reviewed_requests'?{schema_version:'fx-reviewed-request-index/1',owner_id:'${id(1)}',pending_request_id:fixture.pending,requests:[]}:name==='read_fx_lot_portions'?fixture.portions:fixture.context,error:fixture.fail||fixture.failRpc===name?{message:'PRIVATE_ERROR'}:null}}}}`}));
 }}]});const output=join(directory,'fixture.mjs');await writeFile(output,b.outputFiles[0].text);return await import(pathToFileURL(output).href);}finally{await rm(directory,{recursive:true,force:true});}
}
test('FX review routes authenticate, read owned complete context, and save reviews for a separate financial confirmation and hold unresolved requests',async()=>{
 const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.match(),/REDIRECT:\/login/);await assert.rejects(m.reversal({lot:id(70)}),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
 const match=await m.match({receipt:id(20)});assert.match(match,/fx-match-form/);assert.match(match,/fx-retained-lot-/);assert.match(match,/Save review and continue/);assert.match(match,/disabled=""/);assert.ok(!match.includes('action="/api'));
 const reversal=await m.reversal({lot:id(70)});assert.match(reversal,/fx-reversal-form/);assert.match(reversal,/all-event version 1/);assert.match(reversal,/KWD 5.000/);
 for(const patch of [{financial_stamp:'b'.repeat(32)},{version:3},{active_count:0},{portions:[]},{owner_id:id(999)}]){f.portions={...fxHistoryFixture().activeReview(),...patch};assert.match(await m.reversal({lot:id(70)}),/fx-reversal-unavailable/);}
 f.portions=fxHistoryFixture().activeReview();f.failRpc='read_fx_lot_portions';assert.match(await m.reversal({lot:id(70)}),/fx-reversal-unavailable/);f.failRpc='';
 assert.match(await m.match({receipt:'bad'}),/fx-match-unavailable/);assert.match(await m.reversal({lot:id(999)}),/fx-reversal-unavailable/);
 f.context.owner_id=id(999);assert.match(await m.match(),/fx-match-unavailable/);f.context=fxAuthoritativeReviewFixture(true);f.fail=true;const fail=await m.reversal({lot:id(70)});assert.match(fail,/fx-pending-unavailable/);assert.ok(!fail.includes('PRIVATE'));f.fail=false;f.pending=id(500);assert.match(await m.match(),/fx-open-request/);assert.doesNotMatch(await m.match(),/fx-match-form/);assert.doesNotMatch(await m.reversal({lot:id(70)}),/fx-reversal-form/);assert.ok(f.calls.every((c:string)=>['read_fx_settlement_catalog','read_fx_lot_portions','read_fx_reviewed_requests'].includes(c)));
});
