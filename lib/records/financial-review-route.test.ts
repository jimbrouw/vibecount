import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { currentFinancialReviewFixture as financialReviewFixture } from './financial-review-fixture';
async function harness(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.financial-review-test-')),f=financialReviewFixture();
 try{
 const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','react-dom/server'],stdin:{resolveDir:root,contents:"import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/review/page.tsx';export async function page(){return renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}))}export {POST as suggest} from './app/api/review/suggest/route.ts';export {POST as cron} from './app/api/cron/quarterly-check/route.ts';export {fixture} from 'test:db';"},plugins:[{name:'inert-financial-review',setup(b){
 b.onResolve({filter:/^next\/(server|navigation|link)$|^@\/lib\/supabase\/(server|admin)$|^test:db$|LogoutButton$|RecordsReviewAgent$|BatchCategorisePanel$/},a=>({path:/^@\/lib\/supabase\//.test(a.path)?'test:db':a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/server'?"export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}":a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/link'?"import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children)}":/RecordsReviewAgent$/.test(a.path)?"import React from 'react';export default function Agent({summary}){return React.createElement('pre',{'data-testid':'inert-review-summary'},JSON.stringify(summary))}":/LogoutButton$|BatchCategorisePanel$/.test(a.path)?"export default function Component(){return null}":`
export const fixture={owner:${JSON.stringify(f.owner)},catalog:${JSON.stringify(f.catalog)},signedIn:true,authError:false,readError:false,captureError:false,contextCalls:[],reads:[],captures:[],latest:{tax_year_start:${f.year},tax_quarter:1,checked_at:'2026-10-17T00:00:00Z',status:'ok',notes:'Historical all clear',coverage_version:null,source_stamp:null,checked_as_of:null},discovery:{financial_records:[{id:'1',user_id:${JSON.stringify(f.owner)}}],invoices:[{id:'2',user_id:'invoice-only'}],bank_transactions:[{id:'3',user_id:'source-only'}]}};
function db(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:fixture.authError?{}:null})},rpc:async(name,args)=>{fixture.contextCalls.push({name,args});if(name==='capture_quarter_readiness'){fixture.captures.push(args);return{data:{owner_id:args.p_owner,tax_year_start:args.p_year,tax_quarter:args.p_quarter,coverage_version:'vibecount.financial-review/2',status:'needs_attention'},error:fixture.captureError?{}:null}}return{data:fixture.catalog,error:fixture.readError?{message:'PRIVATE'}:null}},from(table){let after=null,filters=[],columns,head=false;const result=()=>{fixture.reads.push({table,after,filters,columns});if(head)return{data:null,count:28,error:fixture.readError?{}:null};if(table==='quarterly_readiness_checks')return{data:fixture.latest,error:fixture.readError?{}:null};return{data:(fixture.discovery[table]||[]).filter(r=>!after||r.id>after).slice(0,1),error:fixture.readError?{}:null}};const q={select(c,o){columns=c;head=!!o?.head;return q},eq(k,v){filters.push([k,v]);return q},in(){return q},is(){return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},maybeSingle:async()=>result(),then(ok,fail){return Promise.resolve(result()).then(ok,fail)}};return q}}}export async function createClient(){return db()}export function createAdminClient(){return db()}
`}));
 }}]});const path=join(dir,'bundle.mjs');await writeFile(path,b.outputFiles[0].text);return await import(pathToFileURL(path).href);
 }finally{await rm(dir,{recursive:true,force:true})}
}
test('review page shows complete counts, currency/source coverage and unverified history; failed catalog withholds all figures',async()=>{
 const m=await harness(),html=await m.page();assert.match(html,/27 approved records/);assert.match(html,/review-invoice-currency-USD/);assert.match(html,/USD 1000.00/);assert.match(html,/Historical quarter check/);assert.doesNotMatch(html,/PRIVATE_/);m.fixture.readError=true;assert.match(await m.page(),/financial-review-unavailable/);m.fixture.authError=true;await assert.rejects(m.page(),/REDIRECT:\/login/);
});
test('current page and provider reads reject predecessor or omitted bank coverage; source-only quarters stay visible',async()=>{
 const m=await harness(),f=m.fixture,c=f.catalog;
 for(let i=1;i<4;i++)c.bank_source_coverage.observations[i].cash_date=`${c.tax_year_start}-07-06`;
 c.quarters[0].source_count=1;c.quarters[1].source_count=3;
 assert.match(await m.page(),/review-quarter-2/);
 c.bank_source_coverage.observations[0].source_available=false;c.source_unavailable_count=1;c.quarters[0].source_unavailable_count=1;
 assert.match(await m.page(),/1 with unavailable source metadata/);
 const body={schema_version:'financial-review-request/1',tax_year_start:c.tax_year_start,expected_stamp:c.stamp,consent:true};
 c.schema_version='vibecount.financial-review/1';assert.match(await m.page(),/financial-review-unavailable/);
 assert.equal((await m.suggest(new Request('http://example.invalid',{method:'POST',body:JSON.stringify(body)}))).status,503);
 c.schema_version='vibecount.financial-review/2';delete c.bank_source_coverage;assert.match(await m.page(),/financial-review-unavailable/);
});
test('AI review rejects forged summaries, missing consent and stale context before bounded provider sharing',async()=>{
 const m=await harness(),f=m.fixture,oldKey=process.env.ANTHROPIC_API_KEY,oldFetch=globalThis.fetch;process.env.ANTHROPIC_API_KEY='inert-test-no-access';let calls=0,payload='';
 globalThis.fetch=async(_url,init)=>{calls++;payload=String(init?.body);return new Response(JSON.stringify({content:[{type:'text',text:'Review the missing source decisions.'}]}))};
 const request=(body:unknown)=>new Request('http://example.invalid/api/review/suggest',{method:'POST',body:JSON.stringify(body)});
 const body={schema_version:'financial-review-request/1',tax_year_start:f.catalog.tax_year_start,expected_stamp:f.catalog.stamp,consent:true};
 try{
  for(const bad of [{summary:{amount:12000}},{...body,consent:false},{...body,extra:'PRIVATE'}, {...body,expected_stamp:'b'.repeat(64)}])assert.ok([400,409].includes((await m.suggest(request(bad))).status));assert.equal(calls,0);
  const r=await m.suggest(request(body));assert.equal(r.status,200);assert.equal(calls,1);assert.doesNotMatch(payload,/PRIVATE_|11111111|record-0/);assert.match(payload,/outstanding_pence/);assert.match(payload,/USD/);
  f.readError=true;assert.equal((await m.suggest(request(body))).status,503);assert.equal(calls,1);f.authError=true;assert.equal((await m.suggest(request(body))).status,401);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey}
});
test('quarter cron discovers invoice-only and source-only owners and delegates computed capture to service SQL',async()=>{
 const m=await harness(),f=m.fixture,prior=process.env.CRON_SECRET;process.env.CRON_SECRET='inert-cron-no-access';
 try{
  assert.equal((await m.cron(new Request('http://example.invalid'))).status,401);assert.equal(f.captures.length,0);
  const req=()=>new Request('http://example.invalid',{headers:{authorization:'Bearer inert-cron-no-access'}});
  let r=await m.cron(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,checked:3,saved:3,failed:0});assert.deepEqual(f.captures.map((v:{p_owner:string})=>v.p_owner),[f.owner,'invoice-only','source-only']);
  f.captureError=true;r=await m.cron(req());assert.deepEqual(await r.json(),{ok:false,checked:3,saved:0,failed:3});f.readError=true;assert.equal((await m.cron(req())).status,500);
 }finally{if(prior===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prior}
});
