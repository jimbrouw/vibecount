import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
async function harness(){
    const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.native-invoice-route-test-'));
    try{
        const result=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Edit from './app/dashboard/invoices/edit/page.tsx';import History from './app/dashboard/invoices/history/page.tsx';export async function edit(){return renderToStaticMarkup(await Edit({searchParams:Promise.resolve({id:'invoice'})}))}export async function history(){return renderToStaticMarkup(await History({searchParams:Promise.resolve({id:'invoice'})}))}export * from './app/dashboard/invoices/actions.ts';export {fixture} from 'test:db';`},plugins:[{name:'inert-native-boundary',setup(b){
            b.onResolve({filter:/^(next\/(navigation|cache|link)|resend|@\/lib\/supabase\/server|test:db)$|InvoiceBuilder$|LogoutButton$/},a=>({path:a.path.startsWith('next/')||a.path==='resend'||/InvoiceBuilder$|LogoutButton$/.test(a.path)?a.path:'test:db',namespace:'fixture'}));
            b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':a.path==='next/link'?"import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children)}":/InvoiceBuilder$|LogoutButton$/.test(a.path)?"import React from 'react';export default function Component(){return React.createElement('div',{'data-testid':'inert-native-component'})}":a.path==='resend'?"import {fixture} from 'test:db';export class Resend{emails={send:async()=>{fixture.sends++;return{data:{id:'inert'},error:null}}}}":`
export const fixture={signedIn:true,authError:false,readError:false,invoice:{id:'invoice',user_id:'owner',client_id:'client',origin:'native_gbp',currency:'GBP',amount:'120.00',number:'NATIVE-1',status:'finalised',updated_at:'current',invoice_date:'2026-04-05',payment_terms:'30 days',due_date:'2026-05-05',net_pence:null,vat_pence:null,vat_rate_bps:null,vat_enabled:null,vat_number_snapshot:null,economics_version:0,clients:{name:'Synthetic client',email:'customer@example.invalid'}},revisions:[],writes:[],reads:[],sends:0,balance:{currency:'GBP',status:'finalised',updated_at:'current',outstanding_pence:12000,has_credit_history:false}};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:fixture.authError?{}:null})},from(table){let mutation=false;const result=()=>({data:table==='invoices'?fixture.invoice:table==='invoice_revisions'?fixture.revisions:table==='invoice_payment_balances'?fixture.balance:table==='clients'?[fixture.invoice.clients]:table==='user_settings'?{}:null,error:table==='invoices'&&fixture.readError?{message:'PRIVATE'}:null});const q={select(columns){fixture.reads.push({table,columns});return q},eq(){return q},order(){return q},limit(){return q},lt(){return q},is(){return q},update(data){mutation=true;fixture.writes.push({table,data});return q},delete(){mutation=true;fixture.writes.push({table,delete:true});return q},maybeSingle:async()=>result(),then(ok,fail){return Promise.resolve(result()).then(ok,fail)}};return q}}}` }));
        }}]});const path=join(dir,'fixture.mjs');await writeFile(path,result.outputFiles[0].text);return await import(pathToFileURL(path).href);
    }finally{await rm(dir,{recursive:true,force:true});}
}
function form(){const f=new FormData();f.set('invoiceId','invoice');f.set('redirectTo','/dashboard');return f;}
test('direct native invoice mutations reject external, missing and failed metadata before writes',async()=>{
    const m=await harness(),f=m.fixture,native=structuredClone(f.invoice);
    const actions=['markInvoiceSent','markInvoicePaid','enableInvoiceReminders','disableInvoiceReminders','deleteInvoice'];
    for(const patch of [{origin:'preserved_external',currency:'USD',amount:null},{origin:'preserved_external',currency:'GBP'},{origin:undefined},{currency:undefined},{amount:null},{user_id:'other'}]){
        f.invoice={...native,...patch};for(const name of actions)await assert.rejects(m[name](form()),/error=/);assert.equal(f.writes.length,0);
    }
    f.invoice=native;f.readError=true;for(const name of actions)await assert.rejects(m[name](form()),/error=/);assert.equal(f.writes.length,0);f.readError=false;
    f.signedIn=false;for(const name of actions)await assert.rejects(m[name](form()),/REDIRECT:\/login/);assert.equal(f.writes.length,0);
    f.signedIn=true;f.authError=true;for(const name of actions)await assert.rejects(m[name](form()),/REDIRECT:\/login/);assert.equal(f.writes.length,0);
});
test('native paid, sent, scheduling and delete actions still handle explicit native GBP rows',async()=>{
    const m=await harness(),f=m.fixture;
    for(const [name,result] of [['markInvoiceSent','invoiceSent=1'],['markInvoicePaid','invoicePaid=1'],['enableInvoiceReminders','remindersEnabled=1'],['disableInvoiceReminders','remindersDisabled=1'],['deleteInvoice','invoiceDeleted=1']])await assert.rejects(m[name](form()),new RegExp(result));
    const uppercase=form();uppercase.set('invoiceId','INVOICE');await assert.rejects(m.markInvoicePaid(uppercase),/invoicePaid=1/);
    assert.equal(f.writes.filter((w:{table:string})=>w.table==='invoices').length,6);assert.equal(f.sends,0);
});
test('native edit and history withhold foreign or missing units before GBP editor and revision reads',async()=>{
    const m=await harness(),f=m.fixture,native=structuredClone(f.invoice);
    for(const patch of [{origin:'preserved_external',currency:'USD',amount:null},{origin:'preserved_external',currency:'GBP',amount:null},{origin:undefined},{amount:null}]){
        f.invoice={...native,...patch};f.reads=[];
        assert.match(await m.edit(),/invoice-native-edit-unavailable/);assert.match(await m.history(),/invoice-native-history-unavailable/);
        assert.ok(!f.reads.some((r:{table:string})=>r.table==='invoice_revisions'));assert.equal(f.writes.length,0);
    }
    f.invoice=native;assert.match(await m.edit(),/inert-native-component/);assert.match(await m.history(),/invoice-history/);
    f.signedIn=false;await assert.rejects(m.edit(),/REDIRECT:\/login/);await assert.rejects(m.history(),/REDIRECT:\/login/);
});
