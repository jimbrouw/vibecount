// Synthetic history created through the reviewed SQL APIs in a disposable database.
import { randomBytes, randomUUID } from 'node:crypto';
import type { BankValuationDb } from './bank-valuation-fixture';

export async function nativeBalanceFixture(db: BankValuationDb) {
  const owner = randomUUID(), other = randomUUID(), client = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic client')", [client, owner]);
  const auth = async (id = owner) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const ids: Record<string, string> = {}, revisions: { args: unknown[]; result: unknown }[] = [];
  for (const name of ['manual', 'partial', 'settled', 'returned', 'credited']) {
    const invoice = randomUUID(), revision = randomUUID(), path = `${owner}/revisions/${revision}.pdf`;
    ids[name] = invoice;
    await db.exec('reset role');
    await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)", [path]);
    await auth();
    const data = { client_id: client, number: `SYNTHETIC-${name}`, invoice_date: '2026-04-05', due_date: '2026-05-05', description: 'Synthetic reviewed work', payment_terms: '30 days', net_pence: 12000, vat_pence: 0, vat_rate_bps: 0, vat_enabled: false, vat_number: '', reason: 'Synthetic reviewed fixture' };
    const args = [invoice, revision, null, JSON.stringify(data), path, 'a'.repeat(64)];
    const result = (await db.query<{ r: unknown }>('select save_invoice_revision($1,$2,$3,$4,$5,$6) r', args)).rows[0].r;
    revisions.push({ args, result });
  }
  ids.draft = randomUUID();
  await db.query("insert into invoices(id,user_id,client_id,number,description,amount) values($1,$2,$3,'SYNTHETIC-ZERO','Synthetic draft',0)", [ids.draft, owner, client]);
  await db.query("update invoices set delivery_status='paid',paid_at='2026-04-06' where id=$1", [ids.manual]);
  await db.exec('reset role');
  const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic bank','starling','bank','1234') returning id", [owner])).rows[0].id;
  const upload = randomUUID(), path = `${owner}/${upload}.enc`;
  await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')", [upload, owner, account, randomBytes(32).toString('hex'), path]);
  await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
  await db.exec('set role service_role');
  const imported = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, upload, JSON.stringify([28000, -1000].map((pence, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'synthetic', date: `2026-04-0${i + 6}`, signed_pence: pence, currency: 'GBP', description: 'Synthetic receipt or refund', reference: '', fingerprint: randomBytes(32).toString('hex') })))] )).rows[0].r;
  await auth();
  const transactions = (await db.query<{ id: string }>('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number', [imported.import_id])).rows;
  const receipt = transactions[0].id, refund = transactions[1].id;
  const category = (await db.query<{ id: string }>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
  await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic reviewed receipt')", [receipt, category]);
  const allocations = [];
  for (const [name, amount] of [['partial', 4000], ['settled', 12000], ['returned', 12000]] as const) {
    const row = (await db.query<{ updated_at: string }>('select updated_at::text updated_at from invoices where id=$1', [ids[name]])).rows[0];
    allocations.push({ invoice_id: ids[name], invoice_updated_at: row.updated_at, amount_pence: amount });
  }
  const allocationArgs = [receipt, 1, JSON.stringify(allocations), 'Synthetic reviewed match', randomUUID(), 0];
  const allocationResult = (await db.query<{ r: unknown }>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r', allocationArgs)).rows[0].r;
  const credits: { args: unknown[]; result: unknown }[] = [];
  for (const [name, gross] of [['returned', 3000], ['credited', 12000]] as const) {
    const credit = randomUUID(), path = `${owner}/credits/${credit}.pdf`;
    const b = (await db.query<{ number: string; balance_stamp: string }>('select number,balance_stamp from invoice_credit_choices where id=$1', [ids[name]])).rows[0];
    const document = { number: `CN-${b.number}-001`, creditDate: '2026-04-07', invoiceNumber: b.number, invoiceDate: '2026-04-05', description: 'Synthetic reviewed work', sellerName: 'Synthetic seller', sellerAddress: '', clientName: 'Synthetic client', clientAddress: '', reason: 'Synthetic reviewed credit', grossPence: gross, netPence: gross, vatPence: 0, taxStatus: 'invoice_snapshot', vatRateBps: 0, vatNumber: '', reviewHash: 'b'.repeat(64) };
    await db.exec('reset role');
    await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)", [path]);
    await auth();
    const args = [ids[name], credit, b.balance_stamp, '2026-04-07', gross, document.reason, JSON.stringify(document), path, 'c'.repeat(64)];
    const result = (await db.query<{ r: unknown }>('select approve_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$9) r', args)).rows[0].r;
    credits.push({ args, result });
  }
  const stamp = (await db.query<{ s: string }>('select refund_group_stamp($1) s', [receipt])).rows[0].s;
  await db.query("select approve_refund($1,1,$2,0,$3,'Synthetic reviewed refund',$4)", [receipt, refund, stamp, randomUUID()]);
  const refundLink = (await db.query<{ id: string }>('select id from active_refunds where refund_transaction_id=$1', [refund])).rows[0].id;
  const allocation = (await db.query<{ id: string }>('select id from active_invoice_allocations where invoice_id=$1', [ids.returned])).rows[0].id;
  const financialStamp = async () => (await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s;
  const assignmentArgs = [credits[0].args[1], allocation, refundLink, 1000, await financialStamp(), 'Synthetic returned cash assignment', randomUUID()];
  const assignmentResult = (await db.query<{ r: unknown }>('select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r', assignmentArgs)).rows[0].r;
  return { owner, other, client, ids, receipt, auth, revisions, credits, allocationArgs, allocationResult, assignmentArgs, assignmentResult, financialStamp };
}
