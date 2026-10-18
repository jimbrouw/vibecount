import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
async function harness() {
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.invoice-reporting-test-'));
 try {
  const result=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Dashboard from './app/dashboard/page.tsx';import Projects from './app/dashboard/projects/page.tsx';export async function dashboard(){return renderToStaticMarkup(await Dashboard({searchParams:Promise.resolve({})}))}export async function projects(){return renderToStaticMarkup(await Projects({searchParams:Promise.resolve({})}))}export {tagInvoiceToProject} from './app/dashboard/projects/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-reporting',setup(b){
   b.onResolve({filter:/^next\/(navigation|cache|link)$|^@\/lib\/supabase\/server$|^test:db$|invoices\/actions$|(?:LogoutButton|PlainLanguageNote|EmailInvoiceButton|ChaseInvoiceButton|DeleteInvoiceButton)$/},a=>({path:a.path==='@/lib/supabase/server'?'test:db':a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children)}":a.path.endsWith('invoices/actions')?"export async function disableInvoiceReminders(){};export async function discardReminderDraft(){};export async function enableInvoiceReminders(){};export async function markInvoicePaid(){};export async function markInvoiceSent(){};export async function sendApprovedReminder(){}":/Button$|PlainLanguageNote$/.test(a.path)?`import React from 'react';export default function Component(){return React.createElement('span',{'data-testid':${JSON.stringify(a.path.split('/').pop())}})}`:`
const native={id:'a-native',user_id:'owner',origin:'native_gbp',currency:'GBP',amount:'120.00',original_total_minor:null,currency_ruleset_id:null,source_fact_revision_id:null,source_fact_family_id:null,status:'finalised',number:'NATIVE-1',invoice_date:'2026-04-05',due_date:'2026-05-05',updated_at:'current',payment_terms:'30 days',delivery_status:'draft',sent_at:null,paid_at:null,reminder_enabled:false,next_reminder_at:null,pdf_path:'native.pdf',project_id:'project',clients:{name:'Synthetic client',email:'customer@example.invalid'}};
const external={...native,id:'b-external',origin:'preserved_external',currency:'USD',amount:null,original_total_minor:'12345',currency_ruleset_id:'vibecount-currencies/1',source_fact_revision_id:'11111111-1111-4111-8111-111111111111',source_fact_family_id:'22222222-2222-4222-8222-222222222222',number:'EXTERNAL-1',pdf_path:'encrypted-private-original'};
export const fixture={native,external,invoices:[native,external],balances:[{id:'a-native',status:'finalised',currency:'GBP',updated_at:'current',invoice_pence:12000,allocated_pence:3000,credited_pence:0,outstanding_pence:9000,refund_due_pence:0,returned_pence:0,settlement_state:'part_paid',has_reconciliation_history:true,paid_at:null,delivery_status:'draft'}],signed:[],reads:[],writes:[],pageSize:1,failAfter:false,drift:false,stamps:0,authError:false,signedIn:true,updateMissing:false};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:fixture.authError?{}:null})},rpc:async()=>({data:fixture.drift?String(++fixture.stamps):'current-stamp',error:null}),storage:{from(){return{createSignedUrl:async(path)=>{fixture.signed.push(path);return{data:{signedUrl:'https://example.invalid/native'}}}}}},from(table){let columns='',after=null,filters={},mutation=false;const result=()=>{
 fixture.reads.push({table,columns,after,filters:{...filters}});
 if(mutation)return{data:fixture.updateMissing?null:{id:filters.id},error:null};
 let rows=table==='invoices'?fixture.invoices:table==='invoice_payment_balances'?fixture.balances:table==='projects'?[{id:'project',name:'Synthetic project',description:'',budget_pence:0,status:'active',clients:null}]:table==='financial_records'?[{id:'record',project_id:'project',record_type:'income',record_date:'2026-04-05',description:'Received once',amount:'30.00',effect_sign:1,status:'approved'}]:table==='user_settings'?{legal_name:'Synthetic owner'}:[];
 if(table==='invoices' && filters.id)return{data:rows.find(r=>r.id===filters.id)||null,error:null};
 if(Array.isArray(rows)&&table!=='invoices'&&table!=='invoice_payment_balances'&&table!=='financial_records')return{data:rows,error:null};
 if(Array.isArray(rows)&&!columns.includes('invoice_date')){if(after&&fixture.failAfter)return{data:null,error:{message:'private late failure'}};rows=rows.filter(r=>!after||r.id>after).slice(0,fixture.pageSize)}
 return{data:rows,error:null};};
 const q={select(c){columns=c;return q},eq(k,v){filters[k]=v;return q},in(){return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},update(data){mutation=true;fixture.writes.push({table,data,filters});return q},maybeSingle:async()=>result(),then(ok,fail){return Promise.resolve(result()).then(ok,fail)}};return q}}}
` }));
  }}]});const path=join(dir,'fixture.mjs');await writeFile(path,result.outputFiles[0].text);return await import(pathToFileURL(path).href);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('dashboard pages all units, keeps GBP cash separate and withholds native controls/storage for external rows',async()=>{
 const m=await harness(),f=m.fixture;const html=await m.dashboard();
 assert.match(html,/dashboard-currency-total-GBP/);assert.match(html,/GBP 120.00/);assert.match(html,/USD 123.45/);assert.match(html,/1 preserved external invoice/);
 assert.match(html,/dashboard-invoice-download-a-native/);assert.match(html,/dashboard-external-invoice-b-external/);
 assert.doesNotMatch(html,/dashboard-invoice-(download|edit|mark-paid-form|enable-reminders-form)-b-external/);
 assert.doesNotMatch(html,/encrypted-private-original/);assert.deepEqual(f.signed,['native.pdf']);
 assert.ok(f.reads.some((r:{table:string;after:string})=>r.table==='invoices'&&r.after==='b-external'));
 assert.ok(f.reads.some((r:{table:string;after:string})=>r.table==='invoice_payment_balances'&&r.after==='a-native'));
 f.external.currency='JPY';f.external.original_total_minor='123';assert.match(await m.dashboard(),/JPY 123/);
 f.external.currency='KWD';f.external.original_total_minor='12345';assert.match(await m.dashboard(),/KWD 12.345/);
 f.external.currency='GBP';assert.match(await m.dashboard(),/GBP 243.45/);assert.equal(f.signed.filter((p:string)=>p!=='native.pdf').length,0);
});
test('missing balance, late read failure, incomplete metadata and stamp drift withhold dashboard totals',async()=>{
 for(const change of ['missing','late','metadata','drift']){const m=await harness(),f=m.fixture;if(change==='missing')f.balances=[];if(change==='late')f.failAfter=true;if(change==='metadata')f.external.currency_ruleset_id=null;if(change==='drift')f.drift=true;
  const html=await m.dashboard();assert.match(html,/dashboard-balances-unavailable/);assert.doesNotMatch(html,/dashboard-currency-totals/);
 }
 const m=await harness();m.fixture.authError=true;await assert.rejects(m.dashboard(),/REDIRECT:\/login/);
});
test('projects group original units separately from recognised GBP income and withhold external project tagging',async()=>{
 const m=await harness(),f=m.fixture;f.external.project_id=null;let html=await m.projects();assert.doesNotMatch(html,/value="b-external"/);
 f.external.project_id='project';html=await m.projects();assert.match(html,/USD 123.45/);assert.match(html,/GBP 120.00/);assert.match(html,/Recognised income \(GBP\)/);assert.match(html,/£30.00/);assert.doesNotMatch(html,/£243.45/);
 f.external.original_total_minor=null;assert.match(await m.projects(),/Invoice totals unavailable/);
 f.failAfter=true;assert.match(await m.projects(),/Complete project totals are unavailable/);
});
test('direct external project tags and stale native updates reject; native tag retains owner/origin/currency/version predicates',async()=>{
 const m=await harness(),f=m.fixture;const form=(id:string)=>{const v=new FormData();v.set('invoiceId',id);v.set('projectId','project');return v};
 await assert.rejects(m.tagInvoiceToProject(form('b-external')),/error=/);assert.equal(f.writes.length,0);
 await assert.rejects(m.tagInvoiceToProject(form('a-native')),/tagged=1/);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].filters,{id:'a-native',user_id:'owner',origin:'native_gbp',currency:'GBP',updated_at:'current'});
 f.updateMissing=true;await assert.rejects(m.tagInvoiceToProject(form('a-native')),/error=/);
 f.authError=true;await assert.rejects(m.tagInvoiceToProject(form('a-native')),/REDIRECT:\/login/);
});
