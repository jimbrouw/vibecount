import { randomBytes, randomUUID } from 'node:crypto';
import { sourceHash, encryptSource, sourceContext, documentContext } from '../records/source-crypto';
import { parseDimensionedSourceCsv } from '../records/source-csv-v2';
import { suggestMapping, readSourceCsv } from '../records/source-csv';
import { rateFromDecimal, type CurrencyCode } from '../fx/currency';
import { bankValuationIntent } from '../records/bank-valuation';
export type BankValuationDb = {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
/** Disposable fixture ONLY. Restoring/closing this database is mandatory; production admission stays closed. */
export async function openSyntheticForeignAdmission(db: BankValuationDb) {
  await db.exec(`alter table financial_accounts drop constraint financial_accounts_currency_check;
    alter table bank_transactions drop constraint bank_transactions_currency_check;
    alter table bank_transactions alter column signed_amount_pence drop not null;`);
}
export async function bankValuationFixture(db: BankValuationDb, currency: CurrencyCode = 'KWD', amount = '-10.001', existingOwner?: string) {
  const owner = existingOwner ?? randomUUID(), other = randomUUID(), account = randomUUID(), imported = randomUUID(), file = randomUUID(), row = randomUUID(), transaction = randomUUID(), upload = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2) on conflict do nothing', [owner, other]);
  const sourceBytes = Buffer.from(`Date,Description,Amount,Currency\r\n05/04/2026,Synthetic foreign observation,${amount},${currency}\r\n`),
    table = readSourceCsv(sourceBytes.toString()), parsed = parseDimensionedSourceCsv(sourceBytes.toString(), suggestMapping(table[0], 'generic'), currency).rows[0],
    key = randomBytes(32), hash = sourceHash(sourceBytes), path = owner + '/' + account + '/' + upload + '.enc',
    cipher = encryptSource(sourceBytes, key, sourceContext(owner, account, hash)), raw = Buffer.from(JSON.stringify(parsed.rawCells)),
    rawCipher = encryptSource(raw, key, sourceContext(owner, account, hash, 2));
  await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,currency,masked_identifier) values($1,$2,'Synthetic foreign account','generic','bank',$3,'1234')", [account, owner, currency]);
  await db.query("insert into record_source_files(id,user_id,account_id,file_hash,object_path,key_id,size_bytes) values($1,$2,$3,$4,$5,'synthetic-v1',$6)", [file, owner, account, hash, path, sourceBytes.length]);
  await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
  await db.query("insert into record_imports(id,user_id,source_type,status,account_id,source_file_id,file_hash,parser_version,coverage_start,coverage_end,metadata) values($1,$2,'csv','review',$3,$4,$5,'mapped-csv/2','2026-04-05','2026-04-05',$6)", [imported, owner, account, file, hash, JSON.stringify({currency})]);
  await db.query('insert into source_rows(id,user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,$3,2,$4,$5)', [row, owner, imported, sourceHash(raw), rawCipher.toString('base64')]);
  await db.query("insert into bank_transactions(id,user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,fingerprint,original_signed_minor,source_units_ruleset) values($1,$2,$3,$4,$5,'2026-04-05',null,$6,'Synthetic foreign observation',$7,$8,'vibecount-currencies/1')", [transaction, owner, account, imported, row, currency, sourceHash(Buffer.from('synthetic:' + transaction)), parsed.signedOriginalMinor]);
  const documentBytes = Buffer.from('%PDF-1.7\nSynthetic documented rate\n%%EOF'), documentHash = sourceHash(documentBytes), attempt = randomUUID(), documentPath = owner + '/' + attempt + '/0.enc', documentCipher = encryptSource(documentBytes, key, documentContext(owner, documentHash));
  await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)", [attempt, owner, documentHash, JSON.stringify([{hash:documentHash,size:documentBytes.length,media_type:'application/pdf',path:documentPath,key_id:'synthetic-v1',name_encrypted:'SYNTHETIC_NAME'}])]);
  await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)", [documentPath]);
  await db.query("select register_document_intake($1,$2,2025,'other','opaque-evidence/1')", [owner, attempt]);
  const document = (await db.query<{id:string}>('select id from evidence_documents where user_id=$1 and file_hash=$2', [owner, documentHash])).rows[0].id;
  const stamp = async () => (await db.query<{s:string}>('select bank_valuation_review_stamp($1) s', [owner])).rows[0].s;
  const intent = async (patch: Record<string, unknown> = {}) => bankValuationIntent({schema_version:'bank-valuation-intent/1',ruleset_id:'vibecount-currencies/1',transaction_id:transaction,transaction_version:0,expected_ordinal:0,state:'reviewed',document_id:document,data:{method:'documented_rate/1',rate:rateFromDecimal(currency,'GBP',currency==='JPY'?'0.005':'2.5'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'},human_read_original:true,expected_stamp:await stamp(),rationale:'Synthetic documented valuation review',request_id:randomUUID(),...patch});
  const record = async (i: unknown, user = owner) => (await db.query<{r:unknown}>('select record_bank_valuation($1,$2) r', [user, JSON.stringify(i)])).rows[0].r;
  return {owner,other,account,imported,file,row,transaction,document,documentPath,documentBytes,documentCipher,documentHash,key,path,sourceBytes,cipher,raw,rawCipher,hash,parsed,stamp,intent,record};
}
