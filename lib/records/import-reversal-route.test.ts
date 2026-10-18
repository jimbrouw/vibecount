import { nativeSourceContextFixture, connectedReviewFixture } from './native-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importReversalFixture } from './import-reversal-fixture';
import { importDependencyFixture, sourceDependenciesFixture } from '../fx/dependency-fixture';
import { refundFixtureId as id } from './refund-split-fixture';
async function fixture() {
    const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.import-reversal-route-test-'));
    try{
        const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','react-dom'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/imports/reversal/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {reverseReviewedImport} from './app/dashboard/imports/reversal/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-import-boundaries',setup(b){
            b.onResolve({filter:/^(next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path.startsWith('next/')?a.path:'test:db',namespace:'fixture'}));
            b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}":`
const sourceDependenciesFixture=${sourceDependenciesFixture.toString()};
const nativeSourceContextFixture=${nativeSourceContextFixture.toString()};
const connectedReviewFixture=${connectedReviewFixture.toString()};
function currentEnvelope(...args){const data=connectedReviewFixture(...args,fixture.extraRows);data.source_context.source_stamp=fixture.sourceStamp;return data}
export const fixture={sourceStamp:'a'.repeat(64),extraRows:[],signedIn:true,context:${JSON.stringify(importReversalFixture())},calls:[],history:[],fxContext:null,prior:false,historyFail:false,readFail:false,writeFail:false};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${id(1)}'}:null},error:null})},from(name){const q={select(){return q},eq(k,v){fixture.history.push([name,k,v]);return q},async maybeSingle(){return {data:fixture.prior?{request_id:'retained'}:null,error:fixture.historyFail?{message:'PRIVATE'}:null}}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:name==='read_source_import_reversal_context_v3'?(fixture.fxContext??(fixture.context?currentEnvelope('import',fixture.context,{},[]):null)):{schema_version:'source-import-reversal-result/1'},error:(name==='read_source_import_reversal_context_v3'?fixture.readFail:fixture.writeFail)?{message:'PRIVATE_DATABASE_DETAIL'}:null}}}}` }));
        }}]});
        const path=join(directory,'fixture.mjs');await writeFile(path,b.outputFiles[0].text);return await import(pathToFileURL(path).href);
    }finally{await rm(directory,{recursive:true,force:true})}
}
function form(){const f=new FormData();for(const[k,v]of Object.entries({importId:id(20),stamp:'f'.repeat(32),sourceStamp:'a'.repeat(64),requestId:id(950),reason:'Reviewed every synthetic import source',humanConfirmed:'yes'}))f.set(k,v);return f;}
test('complete import action authenticates, requires exact confirmation and recomputes owner scope before writing',async()=>{
    const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.reverseReviewedImport(form()),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
    for(const[key,value]of [['importId','bad'],['stamp','bad'],['requestId','bad'],['reason',''],['humanConfirmed','no']]){const bad=form();bad.set(key,value);await assert.rejects(m.reverseReviewedImport(bad),/error=Review/);}const duplicate=form();duplicate.append('importId',id(20));await assert.rejects(m.reverseReviewedImport(duplicate),/error=Review/);assert.equal(f.calls.length,0);
    const good=form();good.set('owner','foreign');good.set('relationships','untrusted');await assert.rejects(m.reverseReviewedImport(good),/result=reversed/);
    assert.deepEqual(f.calls,[{name:'read_source_import_reversal_context_v3',args:{p_id:id(20)}},{name:'reverse_source_import_reviewed',args:{p_id:id(20),p_stamp:'f'.repeat(32),p_reason:'Reviewed every synthetic import source',p_request:id(950)}}]);assert.ok(f.history.some((v:string[])=>v[1]==='user_id'&&v[2]===id(1)));
});
test('complete import action withholds failed, stale or blocked context and preserves database retry authority',async()=>{
    const m=await fixture(),f=m.fixture;f.historyFail=true;await assert.rejects(m.reverseReviewedImport(form()),/history%20unavailable/);assert.equal(f.calls.length,0);f.historyFail=false;
    f.readFail=true;await assert.rejects(m.reverseReviewedImport(form()),/dependencies%20changed/);f.readFail=false;f.context.financial_stamp='0'.repeat(32);await assert.rejects(m.reverseReviewedImport(form()),/dependencies%20changed/);
    f.context=importReversalFixture();f.context.duplicate_references.push({id:id(990),user_id:id(1),transaction_id:id(991),retained_transaction_id:id(110)});f.context.counts.duplicates++;await assert.rejects(m.reverseReviewedImport(form()),/dependencies%20changed/);assert.equal(f.calls.filter((c:{name:string})=>c.name==='reverse_source_import_reviewed').length,0);
    f.prior=true;f.context=null;f.readFail=true;await assert.rejects(m.reverseReviewedImport(form()),/result=reversed/);assert.equal(f.calls.at(-1).name,'reverse_source_import_reviewed');assert.equal(f.calls.at(-1).args.p_stamp,'f'.repeat(32));
    f.writeFail=true;await assert.rejects(m.reverseReviewedImport(form()),e=>{assert.match((e as Error).message,/Reversal%20unavailable/);assert.ok(!(e as Error).message.includes('PRIVATE'));return true});
});
test('complete import page displays safe full scope or withholds incomplete/foreign reads',async()=>{
    const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.render({import:id(20)}),/REDIRECT:\/login/);f.signedIn=true;
    assert.match(await m.render({import:'bad'}),/import-reversal-unavailable/);assert.equal(f.calls.length,0);
    const html=await m.render({import:id(20)});assert.match(html,/import-reversal-review/);assert.match(html,/minus six pounds and seventy pence/);assert.match(html,/Discard only the selected import/);assert.match(html,/7 observations once each/);
    f.context.owner_id=id(999);assert.match(await m.render({import:id(20)}),/import-reversal-unavailable/);f.context=importReversalFixture();f.context.effects.pop();assert.match(await m.render({import:id(20)}),/import-reversal-unavailable/);
    f.context=importReversalFixture();f.context.duplicate_references.push({id:id(990),user_id:id(1),transaction_id:id(991),retained_transaction_id:id(110)});f.context.counts.duplicates++;assert.match(await m.render({import:id(20)}),/import-reversal-blocked/);
});

test('import page exposes linked FX blockers with source/lot routes and never presents native confirmation',async()=>{
 const m=await fixture(),f=m.fixture;f.fxContext={...connectedReviewFixture('import',importReversalFixture(),{},[id(123)]),dependencies:{...importDependencyFixture(true),schema_version:'fx-source-dependencies/1'}};const html=await m.render({import:id(20)});assert.match(html,/import-reversal-fx-blocked/);assert.match(html,/KWD 0.001/);assert.match(html,/GBP 0.00/);assert.match(html,/fx\/reversal\?lot=/);assert.ok(!html.includes('import-reversal-confirm'));assert.ok(!html.includes('import-reversal-readback'));await assert.rejects(m.reverseReviewedImport(form()),/dependencies%20changed/);assert.equal(f.calls.filter((c:{name:string})=>c.name==='reverse_source_import_reviewed').length,0);
});

test('current import source digest rejects missing, duplicate and stale confirmation while retained requests recover',async()=>{
 const m=await fixture(),f=m.fixture;
 for(const mode of ['missing','duplicate','stale']){const body=form();if(mode==='missing')body.delete('sourceStamp');if(mode==='duplicate')body.append('sourceStamp','a'.repeat(64));if(mode==='stale')f.sourceStamp='b'.repeat(64);await assert.rejects(m.reverseReviewedImport(body),/Import%20sources%20or%20dependencies%20changed/)}
 assert.equal(f.calls.filter((c:{name:string})=>c.name==='reverse_source_import_reviewed').length,0);
 f.prior=true;const old=form();old.delete('sourceStamp');await assert.rejects(m.reverseReviewedImport(old),/result=reversed/);
});
test('current import page displays connected unsupported originals without native totals or confirmation',async()=>{
 const m=await fixture(),f=m.fixture,source=f.context.transactions[0];f.extraRows=[{...source,id:id(888),source_row_id:id(889),currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'}];
 const html=await m.render({import:id(20)});assert.match(html,/KWD 10.001/);assert.match(html,/import-reversal-native-blocked/);assert.doesNotMatch(html,/data-testid="import-reversal-review"/);assert.doesNotMatch(html,/name="humanConfirmed"/);
});
