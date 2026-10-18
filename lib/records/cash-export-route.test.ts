import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readSourceCsv} from './source-csv';

test('records JSON/CSV and tax-prep exports agree on receipt cash and preserve magnitudes',async t=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.cash-export-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:root,contents:"export {GET as records} from './app/api/records/export/route';export {GET as tax} from './app/api/tax-prep/export/route';"},plugins:[{name:'inert-db',setup(b){
  b.onResolve({filter:/^next\/server$|^@\/lib\/supabase\/server$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/server'?"export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}":`
const base={record_type:'expense',record_date:'2025-08-01',description:'Synthetic evidence',effect_sign:1,source_type:'receipt_document',source_reference:null,refund_link_id:null,tax_year_start:2025,tax_quarter:2,record_categories:null,record_attachments:[]};
const rows=[{...base,id:'1',amount:'10.00',cash_effect_pence:1000,cash_treatment:'recognized'},{...base,id:'2',amount:'20.00',cash_effect_pence:null,cash_treatment:'unpaid'},{...base,id:'3',amount:'5.00',cash_effect_pence:-500,cash_treatment:'recognized'}];
export async function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async()=>({data:'stable-stamp',error:null}),from(table){let columns='',after=null;const q={select(v){columns=v;return q},eq(){return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},insert:async()=>({error:null}),then(resolve,reject){if(!columns.includes('cash_effect_pence')||!columns.includes('cash_treatment'))return Promise.reject(new Error('Cash projection omitted')).then(resolve,reject);return Promise.resolve({data:after?[]:rows,error:null}).then(resolve,reject)}};return q}}}
`}))}}]});
 const file=join(dir,'routes.mjs');await writeFile(file,result.outputFiles[0].text);const m=await import(pathToFileURL(file).href);
 const json=await m.records(new Request('https://example.invalid?format=json&taxYearStart=2025'));assert.equal(json.status,200);
 const body=await json.json();assert.deepEqual(body.records.map((r:{recognizedPence:string})=>r.recognizedPence),['1000','0','-500']);assert.equal(body.records[1].amountMagnitude,'20.00');assert.equal(body.records[1].cashTreatment,'unpaid');
 const csv=await m.records(new Request('https://example.invalid?format=csv&taxYearStart=2025'));assert.equal(csv.status,200);
 const [head,...rows]=readSourceCsv(await csv.text());assert.deepEqual(rows.map(r=>r[head.indexOf('amount')]),['10.00','0.00','-5.00']);assert.equal(rows[1][head.indexOf('cash_treatment')],'unpaid');
 const tax=await m.tax(new Request('https://example.invalid?format=txt&taxYearStart=2025'));assert.equal(tax.status,200);const text=await tax.text();assert.match(text,/Total Expenses: £5\.00/);assert.match(text,/1 records are excluded from GBP cash totals/);
});
