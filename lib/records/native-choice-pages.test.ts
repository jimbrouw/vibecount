import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeChoiceCoverageFixture } from './native-choice-fixture';
import { bankCoverageFixtureId as id } from './bank-source-coverage-fixture';
import { foreignTaxBankFixture } from '../tax/bank-source-fixture';
import { sourceDependenciesFixture } from '../fx/dependency-fixture';
const owner=id(1);
function sources(){
 const a={id:id(100),user_id:owner,account_id:id(20),import_id:id(10),source_row_id:id(800),transaction_date:'2026-04-06',signed_amount_pence:-100,currency:'GBP',description:'Synthetic original',reference:'',classification:'Business',decision_version:1,dedupe_status:'clear',active_transfer_id:null,active_refund_id:null,has_refunds:false,account_label:'Synthetic bank',account_mask:'1234',account_type:'bank',import_status:'review',record_status:'approved',record_type:'expense',recognized_pence:100,invoice_allocated_pence:0,business_use_bps:10000,effect_sign:1,category_id:id(400),refunded_pence:0,reduced_pence:0,refund_count:0,refund_stamp:'a'.repeat(32)};
 const b={...a,id:id(101),account_id:id(21),import_id:id(11),source_row_id:id(801),signed_amount_pence:100,description:'Synthetic refund',classification:'Unknown',decision_version:0,record_status:null,record_type:null,recognized_pence:0,business_use_bps:0};
 const d={...a,id:id(200),account_id:id(23),import_id:id(12),source_row_id:id(802),signed_amount_pence:100,classification:'Unknown',decision_version:0,record_status:null,record_type:null,recognized_pence:0,business_use_bps:0,fingerprint:'a'.repeat(64),peer_count:1,incoming_duplicate_count:0,active_duplicate_decision_id:null,has_financial_dependencies:false,file_hash:'a'.repeat(64),row_hash:'b'.repeat(64),parser_version:'mapped-csv/1',row_number:2};
 const e={...d,id:id(201),import_id:id(13),source_row_id:id(803)};
 const bank=nativeChoiceCoverageFixture(owner,[a,b,d,e]),foreign=foreignTaxBankFixture().observations[0];
 const foreignSource={...foreign,id:id(102),account_id:id(22),import_id:id(14),source_row_id:id(804)};
 bank.accounts.push({id:id(22),currency:'KWD',representation:'foreign'});Object.assign(bank.counts,{accounts:4,foreign_accounts:1,observations:5,foreign_observations:1,active_blocked_observations:1});
 const coverage={...bank,observations:[...bank.observations,foreignSource]};
 const c={...b,id:foreignSource.id,account_id:foreignSource.account_id,import_id:foreignSource.import_id,source_row_id:foreignSource.source_row_id,transaction_date:foreignSource.cash_date,currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'};
 return{a,b,c,d,e,coverage};
}
async function harness(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.native-choice-pages-')),f=sources();
 try{
 const result=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','react-dom'],stdin:{resolveDir:root,contents:"import {renderToStaticMarkup} from 'react-dom/server';import Transfers from './app/dashboard/reconciliation/transfers/page.tsx';import Refunds from './app/dashboard/reconciliation/refunds/page.tsx';import Duplicates from './app/dashboard/reconciliation/duplicates/page.tsx';export async function render(page,params){return renderToStaticMarkup(await ({transfers:Transfers,refunds:Refunds,duplicates:Duplicates}[page])({searchParams:Promise.resolve(params)}))}export {fixture} from 'test:db';"},plugins:[{name:'native-reader-fixture',setup(b){
 b.onResolve({filter:/^(server-only|next\/(navigation|link)|@\/lib\/supabase\/server|test:db|\.\/actions)$/},a=>({path:a.path==='test:db'||a.path==='@/lib/supabase/server'?'db':a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',resolveDir:root,contents:a.path==='server-only'?'export {};':a.path==='next/navigation'?"export function redirect(path){throw Error('REDIRECT:'+path)}":a.path==='next/link'?"export default function Link({children,...props}){return <a {...props}>{children}</a>}":a.path==='./actions'?'export async function reverseTransfer(){};export async function approveTransfer(){};export async function approveRefund(){};export async function approveDuplicate(){};export async function reverseDuplicate(){}':a.path==='db'?`
const dependencies=${sourceDependenciesFixture.toString()};
export const fixture={signedIn:true,owner:'${owner}',sources:${JSON.stringify(f)},bankReads:0,accountReads:0,typeDrift:false,drift:false,missing:false,contradiction:false,missingPeer:false,pairs:[],calls:[]};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:null})},rpc:async(name)=>{fixture.calls.push({rpc:name});if(name==='read_bank_source_coverage'){fixture.bankReads++;return{data:fixture.missing?null:fixture.drift&&fixture.bankReads%2===0?{...fixture.sources.coverage,stamp:'f'.repeat(64)}:fixture.sources.coverage,error:null}}if(name==='read_fx_source_dependencies')return{data:dependencies(fixture.owner,'f'.repeat(32),[fixture.sources.a,fixture.sources.b]),error:null};return{data:'f'.repeat(32),error:null}},from(table){const filters=[];let cursor=null,take=100,one=false;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},gt(k,v){cursor=v;return q},or(){return q},order(){return q},limit(n){take=n;return q},maybeSingle(){one=true;return Promise.resolve(read())},then(resolve,reject){return Promise.resolve(read()).then(resolve,reject)}};
function read(){fixture.calls.push({table,filters});if(table==='financial_accounts'&&!cursor)fixture.accountReads++;let rows=table==='financial_accounts'?fixture.sources.coverage.accounts.map(a=>({...a,user_id:fixture.owner,account_type:fixture.typeDrift&&fixture.accountReads%2===0?'credit_card':'bank'})):table==='active_transfer_pairs'?fixture.pairs:table==='transfer_transaction_choices'||table==='refund_transaction_choices'?[fixture.sources.a,fixture.sources.b,fixture.sources.c]:table==='duplicate_review_transactions'?[fixture.sources.d,...(fixture.missingPeer?[]:[fixture.sources.e])]:[];rows=rows.filter(r=>filters.every(([k,v])=>k==='user_id'?v===fixture.owner:Array.isArray(v)?v.includes(r[k]):r[k]===v)).filter(r=>!cursor||r.id>cursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,take).map(r=>fixture.contradiction?{...r,signed_amount_pence:999}:r);return{data:one?(rows[0]??null):rows,error:null}}return q}}}
`:''}));
 }}]});const path=join(directory,'fixture.mjs');await writeFile(path,result.outputFiles[0].text);return await import(pathToFileURL(path).href);
 }finally{await rm(directory,{recursive:true,force:true})}
}
test('direct current pages show native controls and foreign originals without null-to-GBP arithmetic or native forms',async()=>{
 const m=await harness(),f=m.fixture;
 const native=await m.render('transfers',{outgoing:id(100),incoming:id(101)});assert.match(native,/transfer-review/);assert.match(native,/KWD 10.001/);assert.doesNotMatch(native,new RegExp('transfer-select-'+id(102)));
 const foreign=await m.render('transfers',{outgoing:id(100),incoming:id(102)});assert.match(foreign,/transfer-withheld/);assert.match(foreign,/ten Kuwaiti dinars and one fil/);assert.doesNotMatch(foreign,/data-testid="transfer-review"/);
 const refund=await m.render('refunds',{original:id(100),refund:id(102)});assert.match(refund,/refund-withheld/);assert.doesNotMatch(refund,/data-testid="refund-review"/);assert.doesNotMatch(refund,new RegExp('refund-cash-'+id(102)));
 const validRefund=await m.render('refunds',{original:id(100),refund:id(101)});assert.match(validRefund,/data-testid="refund-review"/);
 f.signedIn=false;await assert.rejects(m.render('transfers',{}),/login/);assert.ok(f.calls.filter((c:{table?:string})=>c.table).every((c:{filters:unknown[]})=>JSON.stringify(c.filters).includes('user_id')));
});
test('current pages fail closed on bank drift, missing/contradictory sources and incomplete duplicate cohorts',async()=>{
 const m=await harness(),f=m.fixture;
 assert.match(await m.render('duplicates',{transaction:id(200)}),/data-testid="duplicate-review"/);
 for(const mode of ['drift','typeDrift','missing','contradiction'])for(const [page,params]of [['transfers',{outgoing:id(100),incoming:id(101)}],['refunds',{original:id(100),refund:id(101)}],['duplicates',{transaction:id(200)}]]as const){f[mode]=true;f.bankReads=0;f.accountReads=0;const html=await m.render(page,params);assert.doesNotMatch(html,/data-testid="(?:transfer|refund|duplicate)-review"/,mode+':'+page);assert.match(html,/unavailable|changed/);f[mode]=false}
 f.missingPeer=true;const missing=await m.render('duplicates',{transaction:id(200)});assert.doesNotMatch(missing,/data-testid="duplicate-review"/);assert.match(missing,/Complete overlap evidence is unavailable/);
});
test('active pair history survives while reversal controls require both current native endpoints',async()=>{
 const m=await harness(),f=m.fixture,a=f.sources.a,b=f.sources.b;
 const side=(row:typeof a)=>({...row,financial_accounts:{label:'Synthetic bank',masked_identifier:'1234'}});
 f.pairs=[{id:id(500),kind:'transfer',amount_pence:100,outgoing_transaction_id:a.id,incoming_transaction_id:b.id,outgoing:side(a),incoming:side(b)}];
 assert.match(await m.render('transfers',{}),new RegExp('transfer-reverse-'+id(500)+'"'));
 f.pairs[0].incoming_transaction_id=f.sources.c.id;f.pairs[0].incoming=side(f.sources.c);const unsupported=await m.render('transfers',{});assert.match(unsupported,new RegExp('transfer-reverse-withheld-'+id(500)));assert.doesNotMatch(unsupported,new RegExp('data-testid="transfer-reverse-'+id(500)+'"'));assert.match(unsupported,/Review incoming source/);
});
