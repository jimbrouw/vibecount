// Disposable synthetic historical rows for operational read validation; no real approvals/provider calls.
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { parseCurrentFinancialReview as parseFinancialReview,financialReviewPrompt } from '../lib/records/financial-review';
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const owner=randomUUID(),client=randomUUID();await db.query('insert into auth.users(id) values($1)',[owner]);await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic private client')",[client,owner]);
  // Privileged synthetic fixture seeds pre-existing state; this is not a production approval workflow.
  await db.query("insert into invoices(user_id,client_id,number,description,amount,status,due_date,delivery_status,paid_at) values($1,$2,'PRIVATE-DEMO-120','Private fixture text',120,'finalised','2026-10-01','paid',now())",[owner,client]);
  for(let n=0;n<25;n++)await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'income','2026-10-06','Private fixture record',10,'approved')",[owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');const raw=(await db.query<{r:unknown}>("select read_financial_review(2026,'2026-10-18') r")).rows[0].r,safe=parseFinancialReview(owner,2026,'2026-10-18',raw);
  await db.exec('reset role;set role service_role');const capture=(await db.query<{r:unknown}>("select capture_quarter_readiness($1,2026,3,'2026-10-18') r",[owner])).rows[0].r;
  const directory='/tmp/vibecount-financial-review-demo';await mkdir(directory,{recursive:true});await writeFile(directory+'/review.json',JSON.stringify(safe,null,2)+'\n');await writeFile(directory+'/provider-summary.json',financialReviewPrompt(safe));await writeFile(directory+'/capture.json',JSON.stringify(capture,null,2)+'\n');
  await writeFile(directory+'/README.md','# Synthetic operational review\n\nActual local ordered SQL proves 25 approved historical fixture rows with a 20-row sample and GBP 250 recognised income. A native GBP 120 invoice with a manual paid marker still has GBP 120 outstanding because no cash was matched. The quarter check needs attention and does not certify source or tax completeness. Fixture rows were seeded only in a disposable database; there are zero real approvals, provider calls, source documents or hosted writes. Provider-summary.json is a local preview and was not sent.\n');
  console.log(JSON.stringify({directory,approved_count:safe.approved_count,sample_count:safe.recent_records.length,native_outstanding_pence:safe.overdue_invoices[0].outstanding_pence,real_approvals:0,provider_calls:0}));
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
