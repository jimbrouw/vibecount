import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { accountExportFixture } from './account-export-fixture';
let sequence=0;
async function harness(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),f=accountExportFixture();
 const bundle=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:root,contents:"export {GET} from './app/api/backup/export/route.ts';export {fixture} from 'test:db';"},plugins:[{name:'inert-account-export',setup(b){
  b.onResolve({filter:/^(next\/server|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path==='@/lib/supabase/server'?'test:db':a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/server'?"export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}":`
const tables={user_settings:'settings',clients:'clients',invoices:'invoices',financial_records:'financialRecords',invoice_reminders:'invoiceReminders',invoice_revisions:'invoiceRevisions'};
export const fixture={owner:${JSON.stringify(f.owner)},data:${JSON.stringify(f.raw)},signedIn:true,authError:false,contextCalls:0,missingContext:false,changed:false,wrongOwner:false,countOffset:0,failTable:null,failLate:false,failAudit:false,audit:[],reads:[],pageSize:1};
export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:fixture.authError?{}:null})},rpc:async(name)=>{fixture.contextCalls++;return{data:{schema_version:'vibecount.partial-account-context/1',owner_id:fixture.wrongOwner?'other':fixture.owner,stamp:(fixture.changed&&fixture.contextCalls>1?'b':'a').repeat(64),counts:Object.fromEntries(Object.entries(fixture.data).map(([k,v])=>[k,v.length+(k==='clients'?fixture.countOffset:0)]))},error:fixture.missingContext?{message:'PRIVATE_CONTEXT'}:null}},from(table){let cursor=null,filters=[],columns,mutation=false,values;const q={select(c){columns=c;return q},eq(k,v){filters.push([k,v]);return q},gt(k,v){cursor=v;return q},order(){return q},limit(){return q},insert(v){mutation=true;values=v;return q},then(resolve){if(mutation){if(!fixture.failAudit)fixture.audit.push(values);return Promise.resolve({error:fixture.failAudit?{}:null}).then(resolve)}fixture.reads.push({table,cursor,columns,filters});const rows=fixture.data[tables[table]]||[];return Promise.resolve({data:[...rows].sort((a,b)=>a.id.localeCompare(b.id)).filter(r=>!cursor||r.id>cursor).slice(0,fixture.pageSize),error:fixture.failTable===table&&(!fixture.failLate||cursor)?{message:'PRIVATE_READ'}:null}).then(resolve)}};return q}}}
`}));
 }}]});return await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n// isolated '+ ++sequence).toString('base64'));
}
test('partial account endpoint authenticates, owner-pages explicit columns and records exact counts with no-store',async()=>{
 const m=await harness(),f=m.fixture;f.signedIn=false;assert.equal((await m.GET()).status,401);assert.equal(f.contextCalls,0);f.signedIn=true;f.authError=true;assert.equal((await m.GET()).status,401);f.authError=false;
 const response=await m.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);assert.equal(response.headers.get('X-VibeCount-Schema'),'vibecount.partial-account/2');
 const body=await response.text(),out=JSON.parse(body);assert.doesNotMatch(body,/PRIVATE_|12345678|12-34-56/);assert.equal(out.counts.invoiceRevisions,1);assert.equal(out.data.invoices[0].amount,'120.00');assert.equal(f.audit[0].record_count,6);
 assert.ok(f.reads.every((r:{columns:string;filters:[string,string][];table:string})=>r.columns!=='*'&&JSON.stringify(r.filters).includes(JSON.stringify([r.table==='user_settings'?'id':'user_id',f.owner]))));
 assert.equal(f.contextCalls,2);
});
test('partial account export reads over 1000 rows through smaller server page caps without silent omission',async()=>{
 const m=await harness(),f=m.fixture,client=f.data.clients[0];
 for(let n=0;n<1200;n++)f.data.clients.push({...client,id:'client-'+String(n).padStart(5,'0')});f.pageSize=29;
 const response=await m.GET();assert.equal(response.status,200);const out=await response.json();assert.equal(out.counts.clients,1201);assert.equal(out.data.clients.length,1201);assert.equal(out.data.clients.at(-1).id,'client-01199');assert.equal(f.audit[0].record_count,1206);
 assert.ok(f.reads.some((r:{table:string;cursor:string})=>r.table==='clients'&&r.cursor==='client-01199'));
});
test('missing context migration, late read failure, count loss, owner mismatch, drift, oversized output and failed audit withhold all account data',async()=>{
 for(const failure of ['context','late','counts','owner','drift','oversize','audit']){
  const m=await harness(),f=m.fixture;
  if(failure==='context')f.missingContext=true;if(failure==='late'){f.failTable='clients';f.failLate=true}if(failure==='counts')f.countOffset=1;if(failure==='owner')f.wrongOwner=true;if(failure==='drift')f.changed=true;if(failure==='oversize')f.data.clients[0].name='x'.repeat(4_000_000);if(failure==='audit')f.failAudit=true;
  const r=await m.GET();assert.equal(r.status,503,failure);assert.doesNotMatch(await r.text(),/PRIVATE_|data_sha256|NATIVE-120/);assert.equal(f.audit.length,0);
 }
});
