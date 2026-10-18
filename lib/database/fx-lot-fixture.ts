import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { externalInvoiceFixture } from './external-invoice-fixture';
import { rateFromDecimal } from '../fx/currency';
export async function fxConversionLotFixture(db: PGlite) {
  const f = await externalInvoiceFixture(db), intent = await f.intent(), source = await f.proof(intent), saved = await f.capture(intent, source.id);
  await db.exec('reset role');
  const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic lot cash','starling','bank','1234') returning id", [f.owner])).rows[0].id;
  const attempt = randomUUID(), path = `SYNTHETIC/${attempt}.enc`, hash = randomBytes(32).toString('hex');
  await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')", [attempt, f.owner, account, hash, path]);
  await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]); await f.service();
  const imported = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [f.owner, attempt, JSON.stringify([{ row_number: 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'SYNTHETIC', date: '2026-04-06', signed_pence: 2501, currency: 'GBP', description: 'Synthetic lot cash', reference: '', fingerprint: randomBytes(32).toString('hex') }])])).rows[0].r;
  await f.auth(); const tx = (await db.query<{ id: string }>('select id from bank_transactions where import_id=$1', [imported.import_id])).rows[0].id;
  const category = (await db.query<{ id: string }>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
  await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic separate income approval')", [tx, category]);
  const conversionIntent = async (patch: Record<string, unknown> = {}) => {
    await f.auth(); const stamp = (await db.query<{ s: string }>('select fx_evidence_review_stamp() s')).rows[0].s;
    return { ...f.factIntent, family_id: randomUUID(), expected_ordinal: 0, kind: 'conversion', invoice_evidence_revision_id: intent.source_fact_revision_id, transaction_id: tx, transaction_version: 1, expected_stamp: stamp, request_id: randomUUID(), data: { rate: rateFromDecimal('KWD', 'GBP', '2.5'), conversion_date: '2026-04-06', evidence_date: '2026-04-07', invoice_portion_minor: 10001, gbp_cash_portion_pence: 2500, fee_mode: 'none' }, ...patch };
  };
  const review = async (p: unknown) => { await f.auth(); return (await db.query<{ r: { revision_id: string } }>('select review_fx_document_evidence($1) r', [JSON.stringify(p)])).rows[0].r.revision_id; };
  const conversion = await review(await conversionIntent()), lot = randomUUID();
  const bind = async (lotId = lot, sourceId = conversion, invoiceId = intent.invoice_id, revisionId = (saved as { revision_id: string }).revision_id, owner = f.owner) => {
    await f.auth(); await db.exec('reset role'); return (await db.query<{ r: Record<string, unknown> }>('select bind_fx_conversion_lot($1,$2,$3,$4,$5) r', [owner, lotId, invoiceId, revisionId, sourceId])).rows[0].r;
  };
  const before = (await db.query<{ r: unknown }>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1', [tx])).rows;
  return { f, intent, saved, tx, conversionIntent, review, conversion, lot, bind, before };
}
