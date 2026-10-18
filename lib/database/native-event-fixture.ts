import { randomBytes, randomUUID } from 'node:crypto';
import type { BankValuationDb } from './bank-valuation-fixture';
/** Synthetic native metadata through actual ingestion; not proof of readable evidence bytes. */
export async function nativeEventSource(db: BankValuationDb, owner: string, amounts: number[], options: { account?: string; fingerprint?: string } = {}) {
 await db.exec('reset role');let account=options.account;
 if(!account)account=(await db.query<{id:string}>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic native event','generic','bank','1234') returning id",[owner])).rows[0].id;
 const upload=randomUUID(),path='synthetic/'+upload;
 await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[upload,owner,account,randomBytes(32).toString('hex'),path]);
 await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);
 const entries=amounts.map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic-metadata-no-byte-proof',date:'2026-04-06',signed_pence:amount,currency:'GBP',description:'Synthetic event source',reference:'',fingerprint:options.fingerprint??randomBytes(32).toString('hex')}));
 await db.exec('set role service_role');const imported=(await db.query<{r:{import_id:string}}>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",[owner,upload,JSON.stringify(entries)])).rows[0].r.import_id;await db.exec('reset role');
 const transactions=(await db.query<{id:string}>('select t.id from bank_transactions t join source_rows r on r.id=t.source_row_id where t.import_id=$1 order by r.row_number',[imported])).rows.map(t=>t.id);
 return{account,imported,transactions,path};
}
/** Only for rollback/disposable corruption fixtures; never a production mutation path. */
export async function syntheticAccountCurrency(db: BankValuationDb, account: string, currency: string) {
 await db.exec('reset role');await db.exec('alter table financial_accounts disable trigger sourced_account_currency');
 try{await db.query('update financial_accounts set currency=$1 where id=$2',[currency,account]);}finally{await db.exec('alter table financial_accounts enable trigger sourced_account_currency')}
}
