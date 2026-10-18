import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
import { proposeInvoiceMatches, type MatchReceipt, type MatchInvoice } from '../records/match-proposals.ts';
test('source-linked 250, 275 and 1500 suggestions require review and matching creates no additional income', async (t) => {
    const db = new PGlite({ extensions: { pgcrypto } });
    t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort())
        await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const owner = randomUUID();
    await db.query('insert into auth.users values ($1)', [owner]);
    const account = (await db.query<{
        id: string;
    }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic source','starling','bank','1234') returning id", [owner])).rows[0].id, client = (await db.query<{
        id: string;
    }>("insert into clients(user_id,name) values ($1,'Synthetic Gallery') returning id", [owner])).rows[0].id;
    const rows = [25000, 27500, 150000, 1403352].map((pence, i) => ({ row_number: i + 2, row_hash: createHash('sha256').update('synthetic-row-' + i).digest('hex'), raw_encrypted: 'synthetic encrypted fixture', date: '2025-08-01', signed_pence: pence, currency: 'GBP', description: i === 3 ? 'Synthetic Gallery employment income, classification unresolved' : 'Synthetic Gallery freelance payment', reference: 'INV-' + String(i + 1).padStart(3, '0'), fingerprint: createHash('sha256').update('synthetic-identity-' + i).digest('hex') })), hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex'), attempt = randomUUID(), path = 'synthetic/' + attempt;
    await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'synthetic',100,'uploaded')", [attempt, owner, account, hash, path]);
    await db.query("insert into storage.objects(bucket_id,name) values ('source-evidence',$1)", [path]);
    await db.exec('set role service_role');
    const sql = "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", args = [owner, attempt, JSON.stringify(rows)], first = (await db.query<{
        r: {
            import_id: string;
        };
    }>(sql, args)).rows[0].r;
    const retry = (await db.query<{
        r: {
            import_id: string;
            transactions: number;
            created: boolean;
        };
    }>(sql, args)).rows[0].r;
    assert.equal(retry.import_id, first.import_id);
    assert.equal(retry.transactions, 0);
    assert.equal(retry.created, false);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const transactions = (await db.query<{
        id: string;
        signed_amount_pence: string;
    }>('select id,signed_amount_pence from bank_transactions order by signed_amount_pence')).rows, category = (await db.query<{
        id: string;
    }>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
    for (const [index, tx] of transactions.slice(0, 3).entries()) {
        await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed synthetic freelance receipt')", [tx.id, category]);
        const id = randomUUID(), revision = randomUUID(), pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
        pdf.addPage().drawText('Synthetic invoice GBP ' + (Number(tx.signed_amount_pence) / 100).toFixed(2), { font });
        const bytes = await pdf.save(), path = owner + '/revisions/' + revision + '.pdf';
        await db.exec('reset role');
        await db.query("insert into storage.objects(bucket_id,name) values ('invoices',$1)", [path]);
        await db.exec('set role authenticated');
        await db.query('select save_invoice_revision($1,$2,null,$3,$4,$5)', [id, revision, JSON.stringify({ client_id: client, number: 'INV-' + String(index + 1).padStart(3, '0'), invoice_date: '2025-07-01', due_date: '2025-08-01', description: 'Synthetic freelance work', payment_terms: '30 days', net_pence: Number(tx.signed_amount_pence), vat_pence: 0, vat_rate_bps: 0, vat_enabled: false, vat_number: '', reason: 'Human reviewed synthetic invoice' }), path, createHash('sha256').update(bytes).digest('hex')]);
    }
    const receipts = (await db.query<{
        r: MatchReceipt;
    }>("select to_jsonb(r)||jsonb_build_object('record_type',f.record_type) r from receipt_allocation_balances r left join financial_records f on f.id=r.recognized_record_id and f.user_id=r.user_id order by r.signed_amount_pence")).rows.map(r => r.r), invoices = (await db.query<{
        r: MatchInvoice;
    }>("select to_jsonb(i)||jsonb_build_object('client_name',c.name) r from invoice_payment_balances i join clients c on c.id=i.client_id and c.user_id=i.user_id")).rows.map(r => r.r);
    assert.equal(proposeInvoiceMatches(receipts[3], invoices).length, 0);
    const before = (await db.query<{
        n: number;
        pence: number;
    }>("select count(*)::int n,sum(amount*100)::integer pence from financial_records where status='approved' and record_type='income'")).rows[0];
    assert.deepEqual(before, { n: 3, pence: 202500 });
    for (const receipt of receipts.slice(0, 3)) {
        const proposal = proposeInvoiceMatches(receipt, invoices)[0];
        assert.equal(proposal.strength, 'strong');
        assert.equal(proposal.amount_pence, Number(receipt.signed_amount_pence));
        const request = randomUUID(), payload = JSON.stringify([{ invoice_id: proposal.invoice_id, invoice_updated_at: proposal.invoice_updated_at, amount_pence: proposal.amount_pence }]), matchSql = "select approve_invoice_allocations($1,$2,$3,'Human reviewed proposed reference, payer, amount and date',$4,0) r", matchArgs = [receipt.id, receipt.decision_version, payload, request], result = (await db.query(matchSql, matchArgs)).rows[0];
        assert.deepEqual((await db.query(matchSql, matchArgs)).rows[0], result);
    }
    assert.deepEqual((await db.query("select count(*)::int n,sum(amount*100)::integer pence from financial_records where status='approved' and record_type='income'")).rows[0], before);
    assert.equal((await db.query<{
        n: number;
    }>('select count(*)::int n from active_invoice_allocations')).rows[0].n, 3);
    assert.equal((await db.query<{
        n: number;
    }>('select count(*)::int n from invoice_payment_balances where outstanding_pence=0')).rows[0].n, 3);
    assert.equal((await db.query<{
        n: number;
    }>('select count(*)::int n from bank_transactions')).rows[0].n, 4);
});
