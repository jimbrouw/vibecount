import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fxProvenanceFixture } from '../fx/provenance-fixture';
import { fxFixtureId as id } from '../fx/fixture';
import { nativeExportCoverageFixture } from './bank-export-route-fixture';
async function harness(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),f=fxProvenanceFixture(),s=f.sources[0];
 const row={...s,user_id:f.owner,account_id:id(900),original_signed_minor:null,source_units_ruleset:null,description:'PRIVATE_DESCRIPTION',reference:'PRIVATE_REFERENCE',business_use_bps:10000,tax_year_start:2026,source_rows:{row_number:2,row_hash:s.row_hash},record_imports:{id:s.import_id,user_id:f.owner,source_file_id:id(901),file_hash:s.file_hash,parser_version:'mapped-csv/1'}};
 const data={bank_transactions:[row],financial_records:[{id:id(23),bank_transaction_id:s.id,amount:'25.01',status:'approved',record_type:'income',effect_sign:1,refund_link_id:null,transaction:{import_id:s.import_id}}],refund_links:[],fx_provenance_lot_sources:f.raw.lots,invoice_settlements:f.raw.events};
 const source={id:s.import_id,file_hash:s.file_hash,parser_version:'mapped-csv/1',account_id:id(900),status:'review',created_at:'2026-10-18',coverage_start:null,coverage_end:null};
 const b=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:root,contents:"export {GET} from './app/api/imports/[importId]/export/route.ts';export {fixture} from 'test:db';"},plugins:[{name:'inert-fx-source-export',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
  b.onResolve({filter:/^(next\/server|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path==='next/server'?a.path:'db',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/server'?'export class NextResponse extends Response{static json(v,i){return new Response(JSON.stringify(v),i)}}':`
const coverageFixture=${nativeExportCoverageFixture.toString()};
export const fixture={owner:${JSON.stringify(f.owner)},source:${JSON.stringify(source)},data:${JSON.stringify(data)},signedIn:true,reads:[],audits:[],failTable:null,late:false,drift:false,stamps:0,failAudit:false,pageSize:1};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:null})},rpc:async(name)=>{if(name==='read_bank_source_coverage')return{data:coverageFixture(fixture.owner,fixture.source,fixture.data.bank_transactions,fixture.data.financial_records),error:null};if(name==='read_fx_evidence_catalog')return{data:{schema_version:'fx-evidence-catalog/1',owner_id:fixture.owner,ruleset_id:'vibecount-currencies/1',stamp:'a'.repeat(32),counts:{documents:0,receipts:0,facts:0},documents:[],receipts:[],facts:[],financial_action:'evidence_preparation_only'},error:null};return{data:(fixture.drift&&fixture.stamps++?'b':'a').repeat(32),error:null}},from(table){let after=null,filters=[],columns='';const q={select(s){columns=s;return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},not(){return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},maybeSingle(){return Promise.resolve({data:fixture.source,error:null})},single(){return Promise.resolve({data:{label:'Synthetic bank',masked_identifier:'1234'},error:null})},insert(v){fixture.audits.push(v);return Promise.resolve({error:fixture.failAudit?{}:null})},then(resolve){fixture.reads.push({table,after,filters,columns});let rows=table==='financial_accounts'?[{id:fixture.source.account_id,user_id:fixture.owner,currency:'GBP',account_type:'bank'}]:fixture.data[table]||[];for(const[k,v]of filters){if(k==='user_id')continue;rows=rows.filter(r=>{const actual=k.split('.').reduce((o,key)=>o?.[key],r);return Array.isArray(v)?v.includes(actual):actual===v})}rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id)).filter(r=>!after||r.id>after).slice(0,fixture.pageSize);return Promise.resolve({data:rows,error:fixture.failTable===table&&(!fixture.late||after)?{message:'PRIVATE_ERROR'}:null}).then(resolve)}};return q}}}` }));
 }}]});return await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64')+'#'+randomUUID());
}
const request=(format='manifest')=>new Request('http://localhost/export?format='+format);
test('source V5 owner-pages full FX history and V4 ledger keeps accounting effects separate',async()=>{
 const m=await harness(),f=m.fixture,params={params:Promise.resolve({importId:f.source.id})};f.signedIn=false;assert.equal((await m.GET(request(),params)).status,401);assert.equal(f.reads.length,0);f.signedIn=true;
 f.data.fx_provenance_lot_sources.push({...f.data.fx_provenance_lot_sources[0],id:id(999),receipt_id:id(998)});
 f.data.invoice_settlements.push({...f.data.invoice_settlements[0],id:id(997),transaction_id:id(998)});
 const response=await m.GET(request(),params);assert.equal(response.status,200);assert.equal(response.headers.get('X-VibeCount-Schema'),'vibecount.evidence-manifest/5');
 const body=await response.text(),manifest=JSON.parse(body);assert.equal(manifest.snapshot.fx_provenance.lots.length,1);assert.equal(manifest.snapshot.fx_provenance.events.length,3);assert.equal(manifest.snapshot.bank_context.recognized_income_pence,2501);assert.doesNotMatch(body,/PRIVATE|object_path|key_id/);
 assert.ok(f.reads.filter((r:{table:string})=>r.table.startsWith('fx_')||r.table==='invoice_settlements').every((r:{filters:unknown[]})=>JSON.stringify(r.filters).includes(f.owner)));
 assert.ok(f.reads.some((r:{table:string;after:unknown})=>r.table==='invoice_settlements'&&r.after));assert.equal(f.audits[0].record_count,1);
 const before=f.reads.length,csv=await(await m.GET(request('ledger'),params)).text();assert.match(csv,/vibecount.evidence-ledger\/4/);assert.ok(!f.reads.slice(before).some((r:{table:string})=>r.table.startsWith('fx_')||r.table==='invoice_settlements'));
});
test('late FX pages, missing lots, trailing history omission, stale snapshots and audit failures withhold V5 source manifests',async()=>{
 for(const failure of ['late-lot','late-event','missing-lot','trailing-history','foreign-event','drift','audit','oversized']){
  const m=await harness(),f=m.fixture,params={params:Promise.resolve({importId:f.source.id})};
  if(failure==='late-lot'){f.failTable='fx_provenance_lot_sources';f.late=true}if(failure==='late-event'){f.failTable='invoice_settlements';f.late=true}
  if(failure==='missing-lot')f.data.fx_provenance_lot_sources=[];
  if(failure==='trailing-history'){f.data.fx_provenance_lot_sources[0].event_count=6;f.data.fx_provenance_lot_sources[0].active_count=0}
  if(failure==='foreign-event')f.data.invoice_settlements[0].user_id=id(999);
  if(failure==='drift')f.drift=true;if(failure==='audit')f.failAudit=true;if(failure==='oversized')f.source.parser_version='x'.repeat(4000001);
  const response=await m.GET(request(),params);assert.equal(response.status,500,failure);assert.doesNotMatch(await response.text(),/PRIVATE|fx_provenance/);assert.equal(f.audits.length,failure==='audit'?1:0);
 }
});
