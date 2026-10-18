// Disposable synthetic predecessor-upgrade demo. No hosted database or financial approval.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
async function main(){
const db=new PGlite({extensions:{pgcrypto}}),dir=new URL('../supabase/migrations/',import.meta.url),migration='20261018160000_native_invoice_boundary.sql';
try{
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
    const owner=randomUUID(),client=randomUUID(),invoice=randomUUID(),revision=randomUUID(),path=`${owner}/revisions/${revision}.pdf`;
    await db.query('insert into auth.users(id) values($1)',[owner]);await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic client')",[client,owner]);
    await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[path]);
    const auth=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');};
    await auth();const data={client_id:client,number:'SYNTHETIC-NATIVE-120',invoice_date:'2026-04-05',due_date:'2026-05-05',description:'Synthetic reviewed document',payment_terms:'30 days',net_pence:10000,vat_pence:2000,vat_rate_bps:2000,vat_enabled:true,vat_number:'GB-SYNTHETIC',reason:'Synthetic original fixture'};
    const args=[invoice,revision,null,JSON.stringify(data),path,'a'.repeat(64)],save='select save_invoice_revision($1,$2,$3,$4,$5,$6) r';
    const first=(await db.query<{r:unknown}>(save,args)).rows[0].r;
    const snapshot=async()=>(await db.query<{s:unknown}>('select snapshot s from invoice_revisions where id=$1',[revision])).rows[0].s;
    const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const beforeHash=hash(await snapshot()),beforeStamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
    await db.exec('reset role');await db.exec(await readFile(new URL(migration,dir),'utf8'));await auth();
    const recovered=(await db.query<{r:unknown}>(save,args)).rows[0].r;assert.deepEqual(recovered,first);
    assert.equal(hash(await snapshot()),beforeHash);assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,beforeStamp);
    const row=(await db.query<{origin:string;currency:string;amount:string;original_total_minor:null}>('select origin,currency,amount::text amount,original_total_minor from invoices where id=$1',[invoice])).rows[0];assert.equal(row.amount,'120.00');assert.equal(row.origin,'native_gbp');assert.equal(row.original_total_minor,null);
    const outcomes=[];
    for(const change of ["origin='preserved_external'","currency='USD'","original_total_minor=12000","amount=null"]){let rejected=false;try{await db.query('update invoices set '+change+' where id=$1',[invoice]);}catch{rejected=true;}assert.ok(rejected);outcomes.push({change,rejected});}
    const counts=(await db.query<{records:number;settlements:number}>("select (select count(*)::int from financial_records) records,(select count(*)::int from invoice_settlements) settlements")).rows[0];assert.deepEqual(counts,{records:0,settlements:0});
    const output='/tmp/vibecount-native-invoice-demo';await mkdir(output,{recursive:true});
    await writeFile(output+'/compatibility.json',JSON.stringify({synthetic_only:true,invoice:row,original_request_recovered_unchanged:true,revision_snapshot_sha256:beforeHash,revision_snapshot_unchanged:true,financial_context_unchanged:true,rejected_changes:outcomes,...counts,external_invoices_enabled:false},null,2)+'\n');
    await writeFile(output+'/README.md','# Synthetic native invoice compatibility\n\nReplays the actual predecessor migration chain, captures a synthetic native GBP 120.00 invoice through its reviewed revision RPC, applies the additive compatibility migration and recovers the exact old request. The original amount scale, snapshot hash and financial stamp stay unchanged. Non-native identity, foreign currency, duplicate original total and null native amount are rejected; no accounting or settlement rows are created.\n\nStorage objects, PDF hash and review facts are synthetic metadata placeholders, not a readable/decryptable original document. No provider, hosted write, real approval or deployment occurs. External canonical invoices and FX matching remain disabled and incomplete.\n');
    console.log('Verified synthetic native invoice compatibility: '+output);
}finally{await db.close();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
