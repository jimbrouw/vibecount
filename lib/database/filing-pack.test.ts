import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
import { prepareCalculation, canonicalJson, sha256 } from '../tax/snapshot.ts';
import type { CalculationInput } from '../tax/calculation.ts';
import { filingSteps, defaultStepData, buildFilingReview, buildFilingPack, verifyFilingPack, type FilingPackInput, type StepReview, type SavedFilingPack } from '../tax/filing-pack.ts';
import { readSourceCsv } from '../records/source-csv.ts';
test('frozen draft pack ties source review, cross-year reconciliation, tax credits and seven immutable outputs', async (t) => {
    const db = new PGlite({ extensions: { pgcrypto } });
    t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort())
        await db.exec(await readFile(new URL(name, dir), 'utf8'));
    // Some supported runtimes do not return a completion promise from t.test.
    // These scenarios mutate one database and must finish in order.
    async function scenario(name: string, body: () => Promise<void>) { await body(); t.diagnostic(name); }
    const owner = randomUUID(), other = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    async function auth(user: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec(user ? 'set role authenticated' : 'set role anon'); }
    async function service() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.exec('set role service_role'); }
    const accounts: string[] = [];
    for (const provider of ['starling', 'nationwide'])
        accounts.push((await db.query<{
            id: string;
        }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,$2,$2,'bank','1234') returning id", [owner, provider])).rows[0].id);
    const incomeCategory = (await db.query<{
        id: string;
    }>("select id from record_categories where record_type='income' and is_default limit 1")).rows[0].id, expenseCategory = (await db.query<{
        id: string;
    }>("select id from record_categories where record_type='expense' and is_default limit 1")).rows[0].id;
    async function ingest(account: string, items: {
        date: string;
        pence: number;
        description: string;
    }[]) { await db.exec('reset role'); const bytes = Buffer.from(JSON.stringify(items)), hash = createHash('sha256').update(bytes).digest('hex'), attempt = randomUUID(), path = 'PRIVATE/' + attempt; await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'PRIVATE_KEY',$6,'uploaded')", [attempt, owner, account, hash, path, bytes.length]); await db.query("insert into storage.objects(bucket_id,name) values ('source-evidence',$1)", [path]); await service(); const rows = items.map((r, i) => ({ row_number: i + 2, row_hash: sha256(JSON.stringify([r.date, r.pence, r.description])), raw_encrypted: 'SYNTHETIC_ENCRYPTED_PRIVATE', date: r.date, signed_pence: r.pence, currency: 'GBP', description: r.description, reference: 'Synthetic reference', fingerprint: sha256(JSON.stringify([account, r.date, r.pence, r.description])) })); const result = (await db.query<{
        r: {
            import_id: string;
        };
    }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, attempt, JSON.stringify(rows)])).rows[0].r; await auth(); return { id: result.import_id, hash, tx: (await db.query<{
            id: string;
            transaction_date: string;
            signed_amount_pence: string;
        }>('select id,transaction_date,signed_amount_pence from bank_transactions where import_id=$1 order by transaction_date', [result.import_id])).rows }; }
    const contents = [{ date: '2024-08-01', pence: -63029, description: 'Synthetic original business repair' }, { date: '2025-08-01', pence: 150000, description: 'Synthetic freelance receipt account 98765432 sort 11-22-33' }, { date: '2025-09-01', pence: 63029, description: 'Synthetic full business repair refund' }, { date: '2026-04-05', pence: -10000, description: 'Synthetic own-account transfer' }, { date: '2026-07-31', pence: -100000, description: 'Synthetic HMRC payment' }, { date: '2029-08-01', pence: 12300, description: 'Unrelated future receipt' }];
    const first = await ingest(accounts[0], contents), repeat = await ingest(accounts[0], contents);
    assert.equal(first.id, repeat.id);
    const second = await ingest(accounts[1], [{ date: '2026-04-06', pence: 10000, description: 'Synthetic own-account incoming' }]);
    const original = first.tx[0].id, receipt = first.tx[1].id, refund = first.tx[2].id, outgoing = first.tx[3].id, payment = first.tx[4].id, unrelated = first.tx[5].id, incoming = second.tx[0].id;
    await db.query("select review_bank_transaction($1,0,'Mixed',$2,3000,'Reviewed 30 percent business repair')", [original, expenseCategory]);
    await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed freelance receipt')", [receipt, incomeCategory]);
    await db.query("select review_bank_transaction($1,0,'Personal',null,0,'HMRC payment is not a trading expense')", [payment]);
    const refundStamp = (await db.query<{
        s: string;
    }>('select refund_group_stamp($1) s', [original])).rows[0].s;
    await db.query("select approve_refund($1,1,$2,0,$3,'Reviewed original and full refund',$4)", [original, refund, refundStamp, randomUUID()]);
    await db.query("select approve_transfer_pair($1,0,$2,0,'transfer','Reviewed cross-year own-account transfer',$3)", [outgoing, incoming, randomUUID()]);
    const client = (await db.query<{
        id: string;
    }>("insert into clients(user_id,name) values ($1,'Synthetic client') returning id", [owner])).rows[0].id, invoice = randomUUID(), revision = randomUUID(), pdfPath = `${owner}/revisions/${revision}.pdf`;
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Synthetic invoice: GBP 1500.00', { font });
    const pdfBytes = await pdf.save();
    await db.exec('reset role');
    await db.query("insert into storage.objects(bucket_id,name) values ('invoices',$1)", [pdfPath]);
    await auth();
    await db.query('select save_invoice_revision($1,$2,null,$3,$4,$5)', [invoice, revision, JSON.stringify({ client_id: client, number: 'SYNTHETIC-1500', invoice_date: '2025-08-01', due_date: '2025-08-31', description: 'Synthetic freelance work', payment_terms: '30 days', net_pence: 150000, vat_pence: 0, vat_rate_bps: 0, vat_enabled: false, vat_number: '', reason: 'Reviewed synthetic PDF' }), pdfPath, createHash('sha256').update(pdfBytes).digest('hex')]);
    const invoiceUpdated = (await db.query<{
        v: string;
    }>('select updated_at::text v from invoices where id=$1', [invoice])).rows[0].v;
    await db.query("select approve_invoice_allocations($1,1,$2,'Reviewed synthetic receipt matching',$3,0)", [receipt, JSON.stringify([{ invoice_id: invoice, amount_pence: 150000, invoice_updated_at: invoiceUpdated }]), randomUUID()]);
    await db.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-10-01',500,'Synthetic other business costs','manual','approved',$2)", [owner, expenseCategory]);
    const record = (await db.query<{
        id: string;
    }>("select id from financial_records where bank_transaction_id=$1 and effect_sign=-1 and status='approved'", [refund])).rows[0].id;
    const taxStamp = async () => (await db.query<{
        s: string;
    }>('select tax_review_stamp(2025) s')).rows[0].s;
    const taxReview = async (data: unknown) => db.query("select review_tax_inputs(2025,$1,$2,'Reviewed synthetic tax evidence',$3)", [JSON.stringify(data), await taxStamp(), randomUUID()]);
    await taxReview({ action: 'profile', expected_ordinal: 0, state: 'reviewed', data: { jurisdiction: 'england_wales_ni', accounting_basis: 'cash', business_structure: 'sole_trader', vat_registered: 'no', student_loan: 'none', residency: 'uk_full_year', special_reliefs: 'none', ledger_completeness: 'complete' } });
    await taxReview({ action: 'fact', expected_ordinal: 0, kind: 'tax_payment', label: 'Synthetic HMRC statement item', state: 'verified', data: { payment_reference: 'Synthetic statement item', paid_total_pence: 100000, allocated_pence: 100000, allocation_type: 'second_payment_on_account', payment_date: '2026-07-31' }, document_ids: [], transaction_ids: [payment], record_ids: [] });
    await taxReview({ action: 'fact', expected_ordinal: 0, kind: 'vehicle', label: 'Synthetic actual-cost vehicle', state: 'verified', data: { vehicle_type: 'car', method: 'actual_costs', business_use_bps: 3000, business_miles_hundredths: null, period_start: '2025-04-06', period_end: '2026-04-05' }, document_ids: [], transaction_ids: [], record_ids: [record] });
    for (const kind of ['employment', 'termination', 'pension', 'other_income', 'tax_payment', 'vehicle', 'gift_aid', 'trade_adjustment'])
        await taxReview({ action: 'section', kind, verdict: ['tax_payment', 'vehicle'].includes(kind) ? 'complete' : 'none' });
    const scope = { assessment_adjustments: 'none', class4_status: 'not_exempt', class2_election: 'no_voluntary_charge', class2_amount_pence: 0, pension_scope: 'none', net_pay_scope: 'not_applicable', employment_scope: 'none', termination_scope: 'none', payments_scope: 'distinct_identified_allocations_checked', vehicle_scope: 'all_costs_method_history_and_capital_checked', trade_treatment: 'reviewed_no_unmodelled_adjustments', ni_adjustments: 'none', gift_aid_scope: 'none', cash_dates: 'bank_posting_dates_reviewed' };
    await db.query("select review_tax_calculation_scope(2025,0,$1,'reviewed',null,$2,'Reviewed source scope',$3)", [JSON.stringify(scope), await taxStamp(), randomUUID()]);
    const calculation = prepareCalculation((await db.query<{
        v: CalculationInput;
    }>('select read_tax_calculation_input(2025) v')).rows[0].v);
    assert.equal(calculation.result.status, 'estimate');
    assert.equal(calculation.result.totals.ledger_income, 150000);
    assert.equal(calculation.result.totals.ledger_expenses, 31091);
    assert.equal(calculation.result.totals.net_balance, -100000);
    await service();
    const calc = (await db.query<{
        id: string;
    }>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) id', [owner, calculation.inputJson, calculation.resultJson, calculation.rulesJson, 'Reviewed synthetic calculation', randomUUID()])).rows[0].id;
    async function input() { await auth(); return (await db.query<{
        v: FilingPackInput;
    }>('select read_tax_filing_pack_input($1) v', [calc])).rows[0].v; }
    const packInput = await input(), inputJson = canonicalJson(packInput), reviews: StepReview[] = [];
    await scenario('source closure includes cross-year originals, transfer counterpart and actual tax-payment evidence only as context', async () => {
        assert.equal(packInput.calculation_is_current, true);
        assert.ok(packInput.observations.find(o => o.id === original && o.in_tax_year === false));
        assert.ok(packInput.observations.find(o => o.id === incoming && o.in_tax_year === false));
        assert.ok(packInput.observations.find(o => o.id === payment && o.in_tax_year === false));
        assert.ok(!packInput.observations.some(o => o.id === unrelated));
        assert.equal(packInput.imports.length, 2);
        assert.equal(packInput.reconciliation.filter(e => e.kind === 'settlement').length, 1);
        assert.ok(packInput.classifications.some(d => d.transaction_id === payment));
        assert.ok(!inputJson.includes('98765432'));
        assert.ok(!inputJson.includes('11-22-33'));
        assert.ok(!inputJson.includes('PRIVATE'));
        assert.ok(!inputJson.includes('SYNTHETIC_ENCRYPTED'));
        assert.ok(inputJson.includes('[redacted account number]'));
        await assert.rejects(db.query('select tax_filing_pack_input_for_owner($1,$2)', [owner, calc]), /permission denied/);
        await auth(other);
        await assert.rejects(db.query('select read_tax_filing_pack_input($1)', [calc]), /owned saved/);
        await auth('');
        await assert.rejects(db.query('select read_tax_filing_pack_input($1)', [calc]), /permission denied/);
        await auth();
    });
    await scenario('step reviews are service-only, idempotent, immutable and persist all current digests', async () => {
        for (const step of filingSteps) {
            const model = buildFilingReview(packInput, reviews), digest = model.steps.find(s => s.id === step)!.digest, data = step === 'profile' ? { trade_form: 'short', short_eligibility: 'full_year_simple' } : step === 'sources' ? { all_sources_reviewed: true } : step === 'income' ? { all_receipts_are_turnover: true, no_invoice_expected_ids: [] } : defaultStepData(step), request = randomUUID(), args = [owner, calc, inputJson, step, digest, JSON.stringify(data), 'Reviewed synthetic wizard step', request];
            await auth();
            await assert.rejects(db.query('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8)', args), /permission denied/);
            await service();
            const id = (await db.query<{
                id: string;
            }>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) id', args)).rows[0].id;
            assert.equal((await db.query<{
                id: string;
            }>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) id', args)).rows[0].id, id);
            await auth();
            const review = (await db.query<StepReview>('select id,step,digest,data,reason,author,created_at::text from filing_pack_step_reviews where id=$1', [id])).rows[0];
            reviews.unshift(review);
        }
        assert.equal(buildFilingReview(packInput, reviews).canAttest, true);
        await assert.rejects(db.query("update filing_pack_step_reviews set reason='Changed'"), /permission denied/);
    });
    const request = randomUUID(), bundle = buildFilingPack(packInput, reviews, request, true), bundleJson = canonicalJson(bundle);
    let pack: string;
    const capture = async (req = request, b = bundleJson) => { await service(); return (await db.query<{
        id: string;
    }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) id', [owner, calc, inputJson, b, 'Reviewed all seven synthetic outputs', req])).rows[0].id; };
    await scenario('forged provenance, artifact bytes and annual mappings roll back without orphan rows',async()=>{
      for(const kind of ['body','names','mapping','review','status','year','version']){
        const next=randomUUID(),bad=buildFilingPack(packInput,reviews,next,true);
        if(kind==='body')bad.artifacts[0].body+='tampered';
        if(kind==='names')bad.artifacts[1]=bad.artifacts[0];
        if(kind==='mapping')bad.mapping_sha256='0'.repeat(64);
        if(kind==='review')bad.reviews[0]={...bad.reviews[0],id:randomUUID()};
        if(kind==='status')bad.completeness_attested=false;
        if(kind==='year')bad.tax_year_start=2026;
        if(kind==='version')bad.schema_version='draft-filing-pack/1';
        await assert.rejects(capture(next,canonicalJson(bad)),/integrity|provenance|distinct|Completeness|versions/i);
      }
      await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from filing_packs')).rows[0].n,0);assert.equal((await db.query<{n:number}>('select count(*)::int n from tax_form_mappings')).rows[0].n,0);
      await db.exec("create function reject_pack_test() returns trigger language plpgsql as $$begin raise exception 'Injected pack persistence failure';end$$;create trigger reject_pack_test before insert on filing_packs for each row execute function reject_pack_test();");
      const next=randomUUID();await assert.rejects(capture(next,canonicalJson(buildFilingPack(packInput,reviews,next,true))),/Injected pack/);
      await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from tax_form_mappings')).rows[0].n,0);await db.exec('drop trigger reject_pack_test on filing_packs;drop function reject_pack_test();');
    });
    await scenario('all artifacts tie to year ledger and matching creates zero extra income', async () => {
        await auth();
        const count = (await db.query<{
            n: number;
        }>('select count(*)::integer n from financial_records')).rows[0].n;
        pack = await capture();
        assert.equal(await capture(), pack);
        await auth();
        assert.equal((await db.query<{
            n: number;
        }>('select count(*)::integer n from financial_records')).rows[0].n, count);
        const row = (await db.query<SavedFilingPack>('select * from filing_packs where id=$1', [pack])).rows[0];
        assert.equal(verifyFilingPack(row).artifacts.length, 7);
        const ledger = readSourceCsv(bundle.artifacts.find(a => a.name === 'normalized-ledger.csv')!.body), column = ledger[0].indexOf('year_profit_effect_pence'), context = ledger[0].indexOf('context_only');
        assert.equal(ledger.slice(1).reduce((sum, row) => sum + Number(row[column]), 0), 118909);
        assert.ok(ledger.slice(1).filter(row => row[context] === 'true').every(row => row[column] === '0'));
        const recon = readSourceCsv(bundle.artifacts.find(a => a.name === 'invoice-payment-reconciliation.csv')!.body), kind = recon[0].indexOf('row_kind'), effect = recon[0].indexOf('year_trading_effect_pence');
        assert.ok(recon.slice(1).some(row => row[kind] === 'settlement' && row[effect] === '0'));
        await assert.rejects(db.query('select capture_filing_pack($1,$2,$3,$4,$5,$6)', [owner, calc, inputJson, bundleJson, 'No authority', randomUUID()]), /permission denied/);
        await auth(other);
        assert.equal((await db.query('select * from filing_packs')).rows.length, 0);
        await auth();
        await assert.rejects(db.query("delete from filing_packs where id=$1", [pack]), /permission denied/);
    });
    await scenario('a newer answer under the same digest prevents capture of superseded review choices', async () => {
        const profile = reviews.find(r => r.step === 'profile')!;
        await service();
        await db.query('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8)', [owner, calc, inputJson, 'profile', profile.digest, JSON.stringify({ trade_form: 'full', short_eligibility: 'requires_full' }), 'Changed form choice', randomUUID()]);
        const next = randomUUID(), stale = canonicalJson(buildFilingPack(packInput, reviews, next, true));
        await assert.rejects(capture(next, stale), /provenance changed/);
    });
    await scenario('changed evidence invalidates live capture while exact saved retries and stored bytes remain recoverable', async () => {
        await db.exec('reset role');
        const doc = (await db.query<{
            id: string;
        }>("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,'PRIVATE_NEW_DOC','PRIVATE_KEY') returning id", [owner, 'f'.repeat(64)])).rows[0].id;
        await db.query("insert into document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) values ($1,$2,2025,'other','synthetic/1')", [owner, doc]);
        const next = randomUUID(), old = canonicalJson(buildFilingPack(packInput, reviews, next, false));
        await assert.rejects(capture(next, old), /inputs changed/);
        assert.equal(await capture(), pack);
        await auth();
        const row = (await db.query<SavedFilingPack>('select * from filing_packs where id=$1', [pack])).rows[0];
        assert.equal(row.bundle_canonical_json, bundleJson);
        assert.equal(verifyFilingPack(row).artifacts[0].sha256, bundle.artifacts[0].sha256);
    });
});
