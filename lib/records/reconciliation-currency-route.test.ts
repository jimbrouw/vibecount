import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dimensionedExportFixture } from './reconciliation-dimensioned-fixture';
import { fxFixtureId as id } from '../fx/fixture';
import { nativeExportCoverageFixture } from './bank-export-route-fixture';
let harnessVersion = 0;
async function harness() {
 const root=fileURLToPath(new URL('../../',import.meta.url)),input=JSON.parse(JSON.stringify(dimensionedExportFixture()).replaceAll('\"tx\"',JSON.stringify(id(990))).replaceAll('\"native-import\"',JSON.stringify(id(991))).replaceAll('\"row\"',JSON.stringify(id(992))));
 const bankRows=input.legacy[1].map((r:Record<string,unknown>)=>({...r,user_id:input.owner,account_id:id(900),original_signed_minor:null,source_units_ruleset:null,currency:'GBP',business_use_bps:10000,decision_version:0,dedupe_status:'clear',tax_year_start:2026,record_imports:{...(r.record_imports as object),id:r.import_id,user_id:input.owner,source_file_id:id(901),parser_version:'mapped-csv/1'}}));
 const data={bank_transactions:bankRows,financial_accounts:[{id:id(900),user_id:input.owner,currency:'GBP',account_type:'bank'}],invoices:input.documents,fx_document_fact_revisions:input.facts,invoice_settlements:input.events,receipt_allocation_balances:input.legacy[1],invoice_payment_balances:input.legacy[2],fx_lot_export_sources:input.fx_lots,external_invoice_settlement_balances:input.external_balances};
 const result=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:root,contents:"export {GET} from './app/api/reconciliation/export/route.ts';export {fixture} from 'test:db';"},plugins:[{name:'inert-currency-export',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
  b.onResolve({filter:/^(next\/server|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path==='@/lib/supabase/server'?'test:db':a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/server'?"export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}":`
const coverageFixture=${nativeExportCoverageFixture.toString()};
export const fixture={owner:${JSON.stringify(input.owner)},data:${JSON.stringify(data)},signedIn:true,authError:false,reads:[],audit:[],changed:false,stamps:0,failTable:null,failAfter:false,failAudit:false,pageSize:1};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:fixture.authError?{}:null})},rpc:async(name)=>{if(name==='read_bank_source_coverage'){const row=fixture.data.bank_transactions[0],source={id:row.import_id,account_id:row.account_id,file_hash:row.record_imports.file_hash,parser_version:'mapped-csv/1',status:'review'};const c=coverageFixture(fixture.owner,source,fixture.data.bank_transactions,[]);c.observations=fixture.data.bank_transactions.map(r=>coverageFixture(fixture.owner,{...source,id:r.import_id,file_hash:r.record_imports.file_hash},[r],[]).observations[0]);return{data:c,error:null}}if(name==='read_fx_evidence_catalog')return{data:{schema_version:'fx-evidence-catalog/1',owner_id:fixture.owner,ruleset_id:'vibecount-currencies/1',stamp:'a'.repeat(32),counts:{documents:0,receipts:0,facts:0},documents:[],receipts:[],facts:[],financial_action:'evidence_preparation_only'},error:null};return{data:(fixture.changed&&fixture.stamps++?'b':'a').repeat(32),error:null}},from(table){let after=null,filters=[],mutation=false,values,columns;const q={select(v){columns=v;return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},insert(v){mutation=true;values=v;return q},then(resolve){if(mutation){if(!fixture.failAudit)fixture.audit.push(values);return Promise.resolve({error:fixture.failAudit?{}:null}).then(resolve)}fixture.reads.push({table,after,filters,columns});let rows=fixture.data[table]||[];for(const[k,v]of filters)if(k==='id'&&Array.isArray(v))rows=rows.filter(r=>v.includes(r.id));rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id)).filter(r=>!after||r.id>after).slice(0,fixture.pageSize);return Promise.resolve({data:rows,error:fixture.failTable===table&&(!fixture.failAfter||after)?{message:'PRIVATE_READ_ERROR'}:null}).then(resolve)}};return q}}}
`}));
 }}]});return await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n// isolated fixture '+ ++harnessVersion).toString('base64'));
}
test('currency reconciliation route authenticates, owner-pages every dataset and audits the actual V6 row count',async()=>{
 const m=await harness(),f=m.fixture;f.signedIn=false;assert.equal((await m.GET()).status,401);assert.equal(f.reads.length,0);f.signedIn=true;f.authError=true;assert.equal((await m.GET()).status,401);f.authError=false;
 const response=await m.GET();assert.equal(response.status,200);assert.equal(response.headers.get('X-VibeCount-Schema'),'vibecount.reconciliation/6');assert.match(response.headers.get('cache-control')!,/no-store/);
 const csv=await response.text();assert.match(csv,/KWD 10.001/);assert.equal(f.audit[0].record_count,15);assert.ok(f.reads.every((r:{filters:unknown[]})=>JSON.stringify(r.filters).includes(JSON.stringify(['user_id',f.owner]))));assert.ok(f.reads.some((r:{table:string;after:string})=>r.table==='fx_document_fact_revisions'&&r.after));
 assert.doesNotMatch(csv,/PRIVATE_OBJECT|PRIVATE_RAW|PRIVATE_READ_ERROR/);
});
test('currency export pages more than 1000 invoices and chunks captured source IDs without losing rows',async()=>{
 const m=await harness(),f=m.fixture,native=structuredClone(f.data.invoices[0]),balance=structuredClone(f.data.invoice_payment_balances[0]),external=structuredClone(f.data.invoices[1]),fact=structuredClone(f.data.fx_document_fact_revisions[0]);
 for(let n=1;n<=1100;n++){const key='native-'+String(n).padStart(5,'0');f.data.invoices.push({...native,id:key});f.data.invoice_payment_balances.push({...balance,id:key,allocated_pence:0,outstanding_pence:150000})}
 for(let n=1;n<=101;n++){const key='external-'+String(n).padStart(5,'0'),revision=id(1000+n),family=id(2000+n);f.data.invoices.push({...external,id:key,source_fact_revision_id:revision,source_fact_family_id:family});f.data.fx_document_fact_revisions.push({...fact,id:revision,family_id:family});f.data.external_invoice_settlement_balances.push({...f.data.external_invoice_settlement_balances[0],id:key,invoice_revision_id:id(3000+n),allocated_original_minor:0,outstanding_original_minor:10001,allocated_cash_pence:0,settlement_state:'unpaid',has_reconciliation_history:false})}
 f.pageSize=37;const response=await m.GET();assert.equal(response.status,200);const csv=await response.text();assert.match(csv,/native-01100/);assert.match(csv,/external-00101/);assert.equal(f.audit[0].record_count,2417);
 const facts=f.reads.filter((r:{table:string})=>r.table==='fx_document_fact_revisions');assert.ok(facts.length>=5);assert.ok(facts.every((r:{filters:[string,unknown][]})=>(r.filters.find(([k])=>k==='id')![1] as unknown[]).length<=100));
});
test('late pages, missing captured proof, drift and audit failure withhold the whole currency export',async()=>{
 for(const failure of ['late-doc','late-fact','late-lot','missing-lot','missing-fact','native-balance','external-balance','drift','audit']){
  const m=await harness(),f=m.fixture;
  if(failure==='late-doc'){f.failTable='invoices';f.failAfter=true}if(failure==='late-lot'){f.failTable='fx_lot_export_sources';f.failAfter=true}if(failure==='missing-lot')f.data.fx_lot_export_sources=[];if(failure==='external-balance')f.data.external_invoice_settlement_balances=[];if(failure==='late-fact'){f.failTable='fx_document_fact_revisions';f.failAfter=true}if(failure==='missing-fact')f.data.fx_document_fact_revisions=[];if(failure==='native-balance')f.data.invoice_payment_balances=[];if(failure==='drift')f.changed=true;if(failure==='audit')f.failAudit=true;
  const response=await m.GET();assert.equal(response.status,500,failure);assert.doesNotMatch(await response.text(),/invoice_document|PRIVATE|USD/);assert.equal(f.audit.length,0);
 }
});
