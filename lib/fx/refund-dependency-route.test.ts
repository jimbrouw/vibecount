import { nativeSourceContextFixture, connectedReviewFixture } from '../records/native-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitRefundFixture, refundFixtureId as id } from '../records/refund-split-fixture';
import { nativeChoiceCoverageFixture } from '../records/native-choice-fixture';
import { sourceDependenciesFixture } from './dependency-fixture';
async function harness() {
 const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(join(root,'.fx-refund-route-test-')),f=splitRefundFixture();
 try{
  const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','react-dom'],stdin:{resolveDir:root,contents:`
import {renderToStaticMarkup} from 'react-dom/server';import Refunds from './app/dashboard/reconciliation/refunds/page.tsx';import Assignments from './app/dashboard/reconciliation/refund-assignments/page.tsx';export async function renderRefunds(params){return renderToStaticMarkup(await Refunds({searchParams:Promise.resolve(params)}))}export async function renderAssignments(params){return renderToStaticMarkup(await Assignments({searchParams:Promise.resolve(params)}))}export {approveRefund} from './app/dashboard/reconciliation/refunds/actions.ts';export {approveInvoiceRefund,reverseInvoiceRefund} from './app/dashboard/reconciliation/refund-assignments/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-boundaries',setup(b){
   b.onResolve({filter:/^(server-only|next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path==='server-only'||a.path.startsWith('next/')?a.path:'db',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='server-only'?'export {};':a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}":`
const makeDependencies=${sourceDependenciesFixture.toString()};
const sourceDependenciesFixture=makeDependencies;
const nativeSourceContextFixture=${nativeSourceContextFixture.toString()};
const connectedReviewFixture=${connectedReviewFixture.toString()};
export const fixture={bank:${JSON.stringify(nativeChoiceCoverageFixture(f.owner,[f.original,f.refund]))},signedIn:true,owner:'${f.owner}',original:${JSON.stringify(f.original)},refund:${JSON.stringify(f.refund)},stamp:'${f.catalog.stamp}',events:[],prior:false,historyFail:false,readFail:false,writeFail:false,blockedIds:[],sourceStamp:'a'.repeat(64),corrupt:false,drift:false,stamps:0,history:[],balances:[]};
const choice={id:'${id(400)}:${id(401)}',credit_id:'${id(400)}',credit_number:'SYNTHETIC-CREDIT',credit_pdf_sha256:'a'.repeat(64),allocation_id:'${id(401)}',refund_id:'${id(402)}',original_transaction_id:'${f.original.id}',refund_transaction_id:'${f.refund.id}',invoice_id:'${id(403)}',invoice_number:'SYNTHETIC',invoice_pence:1000,allocated_pence:1000,credited_pence:500,returned_pence:100,credit_remaining_pence:400,allocation_remaining_pence:900,refund_remaining_pence:400};
const cash={id:'${id(402)}',transaction_date:'2026-04-10',description:'Synthetic refund',amount_pence:500,assigned_pence:100,unassigned_pence:400,account_label:'Owned account',account_mask:'1234',import_id:'${f.refund.import_id}',original_import_id:'${f.original.import_id}',original_date:'${f.original.transaction_date}',original_description:'Synthetic original'};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:null})},from(name){const filters={};let cursor=null;const q={select(){return q},eq(k,v){filters[k]=v;return q},in(){return q},order(){return q},limit(){return q},gt(k,v){cursor=v;return q},async maybeSingle(){return result(true)},then(resolve,reject){return Promise.resolve(result(false)).then(resolve,reject)}};
function result(single){if(filters.user_id!==fixture.owner)throw new Error('Owner filter missing');
if(name==='refund_requests'||name==='invoice_refund_requests'){fixture.events.push({name:'history',table:name,owner:filters.user_id,request:filters.request_id});return{data:fixture.prior?{request_id:filters.request_id}:null,error:fixture.historyFail?{message:'PRIVATE'}:null}}
if(name==='financial_accounts')return{data:cursor?[]:fixture.bank.accounts.map(a=>({...a,user_id:fixture.owner,account_type:'bank'})),error:null};
if(name==='refund_transaction_choices')return{data:filters.id?[fixture.original,fixture.refund]:[fixture.original,fixture.refund],error:null};
if(name==='customer_refund_balances')return{data:single?cash:[cash],error:null};
if(name==='invoice_refund_choices')return{data:single?choice:[choice],error:null};
if(name==='invoice_refund_assignments')return{data:fixture.history,error:null};
if(name==='invoice_payment_balances')return{data:cursor?[]:fixture.balances,error:null};
if(name==='invoice_refund_assignment_reversals')return{data:[],error:null};
throw new Error('Unexpected table '+name)}return q},async rpc(name,args){fixture.events.push({name,args});
if(name==='read_bank_source_coverage')return{data:fixture.bank,error:null};
if(name==='reconciliation_export_stamp'){fixture.stamps++;return{data:fixture.drift&&fixture.stamps>1?'0'.repeat(32):fixture.stamp,error:null}}
if(name==='read_refund_assignment_context_v2'){const data=connectedReviewFixture('assignment',{owner_id:fixture.owner,stamp:fixture.stamp,transactions:[fixture.original,fixture.refund]},{allocation:args.p_allocation,refund:args.p_refund},fixture.blockedIds);data.source_context.source_stamp=fixture.sourceStamp;if(fixture.corrupt)data.source_context.counts.sources++;return{data,error:fixture.readFail?{message:'PRIVATE'}:null}}
if(name==='read_fx_source_dependencies'||name==='read_refund_assignment_fx_context'){
 let data=makeDependencies(fixture.owner,fixture.stamp,name==='read_fx_source_dependencies'?[fixture.original,fixture.refund]:[fixture.original],fixture.blockedIds);
 if(fixture.corrupt)data.counts.sources++;
 if(name==='read_refund_assignment_fx_context')data={schema_version:'refund-assignment-context/1',allocation_id:args.p_allocation,dependencies:data};
 return{data,error:fixture.readFail?{message:'PRIVATE'}:null}}
if(!['approve_refund','approve_invoice_refund_assignment','reverse_invoice_refund_assignment'].includes(name))throw new Error('Unexpected RPC '+name);
return{data:{retained:true},error:fixture.writeFail?{message:'PRIVATE_FINGERPRINT_MISMATCH'}:null}
}}}
` }));
  }}]});const path=join(directory,'fixture.mjs');await writeFile(path,b.outputFiles[0].text);return await import(pathToFileURL(path).href);
 }finally{await rm(directory,{recursive:true,force:true})}
}
function refundForm(){const f=new FormData();for(const[k,v]of Object.entries({original:id(100),refund:id(102),requestId:id(700),stamp:'a'.repeat(32),originalVersion:'1',refundVersion:'0',reason:'Synthetic source review',humanConfirmed:'yes'}))f.set(k,v);return f}
function assignmentForm(){const f=new FormData();for(const[k,v]of Object.entries({allocationId:id(401),creditId:id(400),refundId:id(402),requestId:id(700),stamp:'f'.repeat(32),sourceStamp:'a'.repeat(64),amount:'1.00',reason:'Synthetic returned cash review',humanConfirmed:'yes'}))f.set(k,v);return f}
test('fresh refund and assignment actions check owned history then complete dependencies; retained requests bypass live state but still verify fingerprints',async()=>{
 const m=await harness(),f=m.fixture;
 for(const [action,form,reader,writer,table]of [[m.approveRefund,refundForm,'read_fx_source_dependencies','approve_refund','refund_requests'],[m.approveInvoiceRefund,assignmentForm,'read_refund_assignment_context_v2','approve_invoice_refund_assignment','invoice_refund_requests']] as const){
  f.events=[];await assert.rejects(action(form()),/result=(approved|assigned)/);
  assert.deepEqual(f.events.map((e:{name:string})=>e.name),['history',reader,writer]);assert.equal(f.events[0].owner,id(1));assert.equal(f.events[0].request,id(700));assert.equal(f.events[0].table,table);
  // Legacy refunds use their group stamp, distinct from global FX stamp.
  assert.equal(f.events.at(-1).args.p_stamp,table==='refund_requests'?'a'.repeat(32):'f'.repeat(32));
  for(const mode of ['blocked','failed','corrupt']){
   f.events=[];f.blockedIds=mode==='blocked'?[id(100)]:[];f.readFail=mode==='failed';f.corrupt=mode==='corrupt';
   await assert.rejects(action(form()),e=>{assert.ok(!String(e).includes('PRIVATE'));return /error=/.test(String(e))});assert.deepEqual(f.events.map((e:{name:string})=>e.name),['history',reader]);
  }
  f.corrupt=false;f.historyFail=true;f.events=[];await assert.rejects(action(form()),/retained/);assert.deepEqual(f.events.map((e:{name:string})=>e.name),['history']);f.historyFail=false;
  f.prior=true;f.events=[];await assert.rejects(action(form()),/result=(approved|assigned)/);assert.deepEqual(f.events.map((e:{name:string})=>e.name),['history',writer]);
  f.writeFail=true;f.events=[];const changed=form();changed.set('reason','Changed retained payload');await assert.rejects(action(changed),/error=/);assert.deepEqual(f.events.map((e:{name:string})=>e.name),['history',writer]);assert.equal(f.events.at(-1).args.p_reason,'Changed retained payload');
  f.prior=false;f.readFail=false;f.writeFail=false;f.blockedIds=[];
 }
 f.blockedIds=[id(100)];f.readFail=true;f.events=[];const reverse=assignmentForm();reverse.set('assignmentId',id(800));await assert.rejects(m.reverseInvoiceRefund(reverse),/result=reversed/);assert.deepEqual(f.events.map((e:{name:string})=>e.name),['reverse_invoice_refund_assignment']);
 f.readFail=false;f.blockedIds=[];f.stamp='0'.repeat(32);f.events=[];await assert.rejects(m.approveInvoiceRefund(assignmentForm()),/dependencies%20changed/);assert.equal(f.events.at(-1).name,'read_refund_assignment_context_v2');
 f.signedIn=false;f.events=[];await assert.rejects(m.approveRefund(refundForm()),/login/);await assert.rejects(m.approveInvoiceRefund(assignmentForm()),/login/);assert.equal(f.events.length,0);
});
test('selected refund and native assignment pages withhold unsafe confirmation and retain assignment cleanup',async()=>{
 const m=await harness(),f=m.fixture,refundParams={original:id(100),refund:id(102)},assignmentParams={refund:id(402),choice:id(400)+':'+id(401)};
 assert.match(await m.renderRefunds(refundParams),/data-testid="refund-review"/);
 assert.match(await m.renderAssignments(assignmentParams),/data-testid="refund-assignment-review"/);
 for(const endpoint of [id(100),id(102)]){
  f.blockedIds=[endpoint];const html=await m.renderRefunds(refundParams);assert.match(html,/refund-fx-blocked/);assert.doesNotMatch(html,/data-testid="refund-review"/);assert.match(html,/GBP 0.00/);assert.match(html,/separate human financial confirmation/);assert.match(html,new RegExp('transaction='+endpoint));
 }
 f.blockedIds=[id(100)];f.history=[{id:id(800),invoice_id:id(403),allocation_id:id(401),credit_id:id(400),refund_id:id(402),amount_pence:100,rationale:'Synthetic history',created_at:'2026-04-10',invoice_snapshot:{number:'SYNTHETIC'},credit_snapshot:{number:'SYNTHETIC-CREDIT',pdf_sha256:'a'.repeat(64)}}];f.balances=[{id:id(403),invoice_pence:1000,allocated_pence:1000,credited_pence:500,returned_pence:100}];
 const blocked=await m.renderAssignments(assignmentParams);assert.match(blocked,/refund-assignment-fx-blocked/);assert.doesNotMatch(blocked,/data-testid="refund-assignment-review"/);assert.match(blocked,new RegExp('refund-assignment-reversal-'+id(800)));
 f.blockedIds=[];for(const mode of ['failed','corrupt','drift']){f.readFail=mode==='failed';f.corrupt=mode==='corrupt';f.drift=mode==='drift';f.stamps=0;assert.doesNotMatch(await m.renderRefunds(refundParams),/data-testid="refund-review"/);f.stamps=0;assert.doesNotMatch(await m.renderAssignments(assignmentParams),/data-testid="refund-assignment-review"/);}
});

test('current assignment source digest binds both endpoints while old request recovery needs no new field',async()=>{
 const m=await harness(),f=m.fixture;
 for(const mode of ['missing','duplicate','stale']){const body=assignmentForm();if(mode==='missing')body.delete('sourceStamp');if(mode==='duplicate')body.append('sourceStamp','a'.repeat(64));if(mode==='stale')f.sourceStamp='b'.repeat(64);await assert.rejects(m.approveInvoiceRefund(body),/dependencies%20changed/)}
 assert.equal(f.events.filter((c:{name:string})=>c.name==='approve_invoice_refund_assignment').length,0);
 f.prior=true;const old=assignmentForm();old.delete('sourceStamp');await assert.rejects(m.approveInvoiceRefund(old),/result=assigned/);
});
test('assignment page shows unsupported returned-cash source without native financial controls',async()=>{
 const m=await harness(),f=m.fixture;Object.assign(f.refund,{currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'});
 const html=await m.renderAssignments({refund:id(402),choice:id(400)+':'+id(401)});assert.match(html,/KWD 10.001/);assert.match(html,/refund-assignment-native-blocked/);assert.doesNotMatch(html,/data-testid="refund-assignment-review"/);
});
