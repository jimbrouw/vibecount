import { nativeSourceContextFixture, connectedReviewFixture } from './native-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceDependenciesFixture } from '../fx/dependency-fixture';
import { refundClosureFixture, refundFixtureId as id } from './refund-split-fixture';

async function fixture() {
    const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.refund-closure-route-test-'));
    try{
        const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/reconciliation/refunds/reversal/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {reverseRefundClosure} from './app/dashboard/reconciliation/refunds/reversal/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-closure-boundaries',setup(b){
            b.onResolve({filter:/^(next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path.startsWith('next/')?a.path:'test:db',namespace:'fixture'}));
            b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}":`
const sourceDependenciesFixture=${sourceDependenciesFixture.toString()};
const nativeSourceContextFixture=${nativeSourceContextFixture.toString()};
const connectedReviewFixture=${connectedReviewFixture.toString()};
function currentEnvelope(...args){const data=connectedReviewFixture(...args,fixture.extraRows);data.source_context.source_stamp=fixture.sourceStamp;return data}
export const fixture={prior:false,historyFail:false,blockedIds:[],sourceStamp:'a'.repeat(64),extraRows:[],signedIn:true,graph:${JSON.stringify(refundClosureFixture())},calls:[],fail:false};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${id(1)}'}:null},error:null})},from(name){if(name!=='refund_requests')throw new Error('Unexpected history table');const q={select(){return q},eq(){return q},async maybeSingle(){return {data:fixture.prior?{request_id:'retained'}:null,error:fixture.historyFail?{}:null}}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:name==='read_refund_reversal_graph_v3'?currentEnvelope('closure',fixture.graph,{kind:args.p_kind,id:args.p_id},fixture.blockedIds):{reversed_count:5},error:fixture.fail?{message:'PRIVATE_DATABASE_DETAIL'}:null}}}}` }));
        }}]});
        const path=join(directory,'fixture.mjs');await writeFile(path,b.outputFiles[0].text);return await import(pathToFileURL(path).href);
    }finally{await rm(directory,{recursive:true,force:true})}
}
function form(){const f=new FormData();for(const [k,v] of Object.entries({kind:'original',source:id(100),requestId:id(800),stamp:'f'.repeat(32),sourceStamp:'a'.repeat(64),reason:'Synthetic entire refund review',humanConfirmed:'yes'}))f.set(k,v);return f}
test('refund closure action authenticates, requires exact human scope and sends only root/stamp to owner-derived SQL',async()=>{
    const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.reverseRefundClosure(form()),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
    for(const [key,value]of [['humanConfirmed','no'],['kind','untrusted'],['source','untrusted'],['stamp','untrusted'],['requestId','untrusted'],['reason','']]){
        const bad=form();bad.set(key,value);await assert.rejects(m.reverseRefundClosure(bad),/error=Review/);assert.equal(f.calls.length,0);
    }
    const good=form();good.set('owner','foreign');good.set('links','["untrusted"]');await assert.rejects(m.reverseRefundClosure(good),/result=reversed/);
    assert.deepEqual(f.calls,[{name:'read_refund_reversal_graph_v3',args:{p_kind:'original',p_id:id(100)}},{name:'reverse_refund_closure',args:{p_kind:'original',p_id:id(100),p_stamp:'f'.repeat(32),p_reason:'Synthetic entire refund review',p_request:id(800)}}]);
    f.prior=true;f.fail=true;await assert.rejects(m.reverseRefundClosure(form()),e=>{assert.match((e as Error).message,/error=Reversal/);assert.ok(!(e as Error).message.includes('PRIVATE'));return true});
});
test('refund reversal page uses authenticated complete metadata and withholds foreign, failed or incomplete reviews',async()=>{
    const m=await fixture(),f=m.fixture,p={kind:'original',id:id(100)};f.signedIn=false;await assert.rejects(m.render(p),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
    assert.match(await m.render({kind:'bad',id:'bad'}),/refund-closure-unavailable/);assert.equal(f.calls.length,0);
    const html=await m.render(p);assert.match(html,/refund-closure-review/);assert.match(html,/5 refund portions/);assert.match(html,/minus six pounds and seventy pence/);
    assert.deepEqual(f.calls[0],{name:'read_refund_reversal_graph_v3',args:{p_kind:'original',p_id:id(100)}});
    f.graph.owner_id=id(999);assert.match(await m.render(p),/refund-closure-unavailable/);f.graph=refundClosureFixture();f.graph.links.splice(1,1);assert.match(await m.render(p),/refund-closure-unavailable/);
    f.graph=refundClosureFixture();f.fail=true;assert.match(await m.render(p),/refund-closure-unavailable/);f.fail=false;
    f.graph=refundClosureFixture(true);f.graph.links[4].assignment_count=1;f.graph.assignments.push({id:id(900),user_id:id(1),refund_id:f.graph.links[4].id,amount_pence:50});
    assert.match(await m.render(p),/refund-closure-blocked/);
});

test('connected FX withholds closure financial totals and fresh writes but retains exact recovery',async()=>{
 const m=await fixture(),f=m.fixture;f.blockedIds=[id(102)];
 const html=await m.render({kind:'original',id:id(100)});
 assert.match(html,/refund-closure-fx-blocked/);assert.match(html,/zero pounds/);assert.match(html,/separate human financial confirmation/);
 assert.doesNotMatch(html,/data-testid="refund-closure-review"/);assert.doesNotMatch(html,/refund-closure-confirm/);
 f.calls=[];await assert.rejects(m.reverseRefundClosure(form()),/linked%20to%20active%20FX/);assert.deepEqual(f.calls.map((c:{name:string})=>c.name),['read_refund_reversal_graph_v3']);
 f.prior=true;f.calls=[];await assert.rejects(m.reverseRefundClosure(form()),/result=reversed/);assert.deepEqual(f.calls.map((c:{name:string})=>c.name),['reverse_refund_closure']);
 f.historyFail=true;f.calls=[];await assert.rejects(m.reverseRefundClosure(form()),/retained%20refund%20request/);assert.equal(f.calls.length,0);
});

test('current closure source digest rejects missing, duplicate and stale confirmation while retained requests recover',async()=>{
 const m=await fixture(),f=m.fixture;
 for(const mode of ['missing','duplicate','stale']){const body=form();if(mode==='missing')body.delete('sourceStamp');if(mode==='duplicate')body.append('sourceStamp','a'.repeat(64));if(mode==='stale')f.sourceStamp='b'.repeat(64);await assert.rejects(m.reverseRefundClosure(body),/Refund%20sources%20changed/)}
 assert.equal(f.calls.filter((c:{name:string})=>c.name==='reverse_refund_closure').length,0);
 f.prior=true;const old=form();old.delete('sourceStamp');await assert.rejects(m.reverseRefundClosure(old),/result=reversed/);
});
test('current closure page displays connected unsupported originals without native totals or confirmation',async()=>{
 const m=await fixture(),f=m.fixture,source=f.graph.transactions[0];f.extraRows=[{...source,id:id(888),source_row_id:id(889),currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'}];
 const html=await m.render({kind:'original',id:id(100)});assert.match(html,/KWD 10.001/);assert.match(html,/refund-closure-native-blocked/);assert.doesNotMatch(html,/data-testid="refund-closure-review"/);assert.doesNotMatch(html,/name="humanConfirmed"/);
});
