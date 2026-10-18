import { randomUUID,createHash } from 'node:crypto';
import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { ACCOUNT_EXPORT_FIELDS,ACCOUNT_EXPORT_TABLES } from '../lib/records/account-export-fields';
import { buildAccountExport,parseAccountExportContext,serializeAccountExport,type AccountExportData,type AccountExportKey,type AccountExportRow } from '../lib/records/account-export';
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const migrations=new URL('../supabase/migrations/',import.meta.url);
  for(const name of(await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
  const owner=randomUUID(),client=randomUUID(),invoice=randomUUID(),record=randomUUID();
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.query("insert into user_settings(id,legal_name,vat_rate) values($1,'Synthetic owner',0)",[owner]);
  await db.query("insert into clients(id,user_id,name,email) values($1,$2,'Synthetic client','customer@example.invalid')",[client,owner]);
  await db.query("insert into invoices(id,user_id,client_id,number,description,amount) values($1,$2,$3,'DEMO-DRAFT-120','Synthetic unapproved draft',120)",[invoice,owner,client]);
  await db.query("insert into financial_records(id,user_id,record_type,record_date,description,amount,status) values($1,$2,'income','2026-04-05','Synthetic unapproved record',30.01,'draft')",[record,owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const first=(await db.query<{r:unknown}>('select read_partial_account_export_context() r')).rows[0].r,context=parseAccountExportContext(owner,first),raw={} as AccountExportData;
  for(const key of Object.keys(ACCOUNT_EXPORT_FIELDS) as AccountExportKey[]){const table=ACCOUNT_EXPORT_TABLES[key];raw[key]=(await db.query<{r:AccountExportRow}>('select to_jsonb(projection) r from(select '+ACCOUNT_EXPORT_FIELDS[key].join(',')+' from '+table+' where '+(key==='settings'?'id':'user_id')+'=$1 order by id)projection',[owner])).rows.map(r=>r.r);}
  const final=parseAccountExportContext(owner,(await db.query<{r:unknown}>('select read_partial_account_export_context() r')).rows[0].r);if(final.stamp!==context.stamp)throw new Error('Synthetic source changed');
  const body=serializeAccountExport(buildAccountExport(owner,raw,context)),directory='/tmp/vibecount-account-export-demo';await mkdir(directory,{recursive:true});await writeFile(directory+'/partial-account.json',body);
  await writeFile(directory+'/manifest.json',JSON.stringify({synthetic:true,sha256:createHash('sha256').update(body).digest('hex'),counts:context.counts,real_approvals:0,bank_connections:0,external_rows_enabled:false,scope:'Actual ordered SQL and owner-scoped context; only synthetic unapproved drafts. Not a restorable backup.'},null,2)+'\n');
  await writeFile(directory+'/README.md','# Synthetic partial account export\n\nGenerated from actual ordered local migrations and authenticated owner reads in disposable PostgreSQL. Draft invoice GBP 120.00, draft record GBP 30.01 and stored VAT rate 0.00 remain exact. No financial approval, external invoice, source document, retained-original decryption or hosted service is involved. This selected-data export omits full histories, files and keys; it cannot restore an account.\n');
  console.log(JSON.stringify({directory,counts:context.counts,real_approvals:0}));
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
