import {serialSubtest} from './serial-subtest.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
import { canonicalJson, prepareCalculation, verifySavedCalculation, type SavedCalculation } from '../tax/snapshot.ts';
import { emptyScope } from '../tax/scope.ts';
import type { CalculationInput } from '../tax/calculation.ts';
import { calculateTax } from '../tax/calculation.ts';
import { rules2025 } from '../tax/rules.ts';
test('immutable draft tax snapshots preserve canonical inputs, owner isolation and exact retry', async (t) => {
    const db = new PGlite({ extensions: { pgcrypto } });
    t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort())
        await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    async function auth(user: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec(user ? 'set role authenticated' : 'set role anon'); }
    async function service() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.exec('set role service_role'); }
    async function input() {
        await auth();
        return (await db.query<{
            v: CalculationInput;
        }>('select read_tax_calculation_input(2025) v')).rows[0].v;
    }
    async function capture(prepared: ReturnType<typeof prepareCalculation>, request = randomUUID()) {
        await service();
        return (await db.query<{
            id: string;
        }>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) id', [owner, prepared.inputJson, prepared.resultJson, prepared.rulesJson, 'Reviewed synthetic draft', request])).rows[0].id;
    }
    await serialSubtest(t,'explicit-owner stamp matches authenticated nested stamp without JWT impersonation', async () => {
        await auth();
        const expected = (await db.query<{
            s: string;
        }>('select reconciliation_export_stamp() s')).rows[0].s;
        assert.equal((await input()).financial_stamp, expected);
        await assert.rejects(db.query('select tax_financial_stamp_for_owner($1)', [other]), /permission denied/);
        await service();
        await assert.rejects(db.query('select tax_calculation_input_for_owner($1,2025)', [owner]), /permission denied/);
        await auth('');
        await assert.rejects(db.query('select read_tax_calculation_input(2025)'), /permission denied/);
    });
    let saved: string;
    const request = randomUUID(), prepared = prepareCalculation(await input());
    await serialSubtest(t,'captures an incomplete draft with no financial effects, rules and exact byte hashes', async () => {
        saved = await capture(prepared, request);
        assert.equal(await capture(prepared, request), saved);
        await auth();
        const row = (await db.query<SavedCalculation>('select * from tax_calculations where id=$1', [saved])).rows[0];
        const rules = (await db.query<{
            id: string;
            canonical_json: string;
            sha256: string;
        }>('select id,canonical_json,sha256 from tax_rulesets')).rows[0];
        assert.equal(row.result.status, 'incomplete');
        assert.equal(verifySavedCalculation(row, rules).input.owner_id, owner);
        assert.equal((await db.query<{
            n: number;
        }>('select count(*)::integer n from financial_records')).rows[0].n, 0);
        await assert.rejects(db.query('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6)', [owner, prepared.inputJson, prepared.resultJson, prepared.rulesJson, 'Reviewed synthetic draft', randomUUID()]), /permission denied/);
        await assert.rejects(db.query('update tax_calculations set rationale=$1 where id=$2', ['Changed', saved]), /permission denied/);
        await auth(other);
        assert.equal((await db.query('select * from tax_calculations')).rows.length, 0);
        await auth();
        await assert.rejects(db.query('delete from tax_calculation_scopes'), /permission denied/);
        assert.throws(() => verifySavedCalculation({ ...row, result_sha256: '0'.repeat(64) }, rules), /integrity/);
    });
    await serialSubtest(t,'reviewed scope is immutable, strictly validated, source-owned and versioned', async () => {
        await auth();
        const stamp = (await db.query<{
            s: string;
        }>('select tax_review_stamp(2025) s')).rows[0].s;
        const data = emptyScope();
        const run = (d: unknown, state = 'provisional', doc: string | null = null, expected = 0, req = randomUUID()) => db.query('select review_tax_calculation_scope(2025,$1,$2,$3,$4,$5,$6,$7)', [expected, JSON.stringify(d), state, doc, stamp, 'Synthetic scope review', req]);
        await assert.rejects(run({ ...data, extra: 'invalid' }), /every scope/);
        await assert.rejects(run(data, 'reviewed'), /scope answer/);
        const req = randomUUID();
        await run(data, 'provisional', null, 0, req);
        await run(data, 'provisional', null, 0, req);
        await assert.rejects(run(data), /changed/);
        await assert.rejects(run({ ...data, class4_status: 'exempt' }, 'provisional', null, 0, req), /different/);
        const reviewed = { assessment_adjustments: 'none', class4_status: 'not_exempt', class2_election: 'verified_amount', class2_amount_pence: 17500, pension_scope: 'none', net_pay_scope: 'not_applicable', employment_scope: 'none', termination_scope: 'none', payments_scope: 'none', vehicle_scope: 'none', trade_treatment: 'reviewed_no_unmodelled_adjustments', ni_adjustments: 'none', gift_aid_scope: 'none', cash_dates: 'bank_posting_dates_reviewed' };
        await assert.rejects(run(reviewed, 'reviewed', null, 1), /owned evidence/);
        await db.exec('reset role');
        const doc = (await db.query<{
            id: string;
        }>("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,'PRIVATE_PATH','PRIVATE_KEY') returning id", [owner, 'f'.repeat(64)])).rows[0].id;
        const foreignDoc = (await db.query<{
            id: string;
        }>("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,'PRIVATE_OTHER','PRIVATE_KEY') returning id", [other, 'e'.repeat(64)])).rows[0].id;
        await auth();
        await assert.rejects(run(reviewed, 'reviewed', foreignDoc, 1), /owned evidence/);
        await run(reviewed, 'reviewed', doc, 1);
        const current = await input();
        assert.equal(current.scope!.is_current, true);
        assert.equal(current.scope!.input_stamp, stamp);
        assert.ok(!canonicalJson(current).includes('PRIVATE_'));
        await db.exec('reset role');
        await assert.rejects(db.query('update tax_calculation_scopes set rationale=$1', ['Changed']), /immutable/);
    });
    await serialSubtest(t,'scope change invalidates new capture but exact old retry still recovers history', async () => {
        await assert.rejects(capture(prepared), /inputs changed/);
        assert.equal(await capture(prepared, request), saved);
        await assert.rejects(capture({ ...prepared, resultJson: canonicalJson({ ...prepared.result, caveat: 'Changed' }) }, request), /different inputs/);
    });
    await serialSubtest(t,'current record edits and category semantics invalidate prepared inputs, preserving old figures', async () => {
        await db.exec('reset role');
        const category = (await db.query<{
            id: string;
        }>("insert into record_categories(user_id,name,record_type,is_default) values ($1,'Synthetic category','expense',false) returning id", [owner])).rows[0].id;
        const id = (await db.query<{
            id: string;
        }>("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',10.01,'Private description','manual','approved',$2) returning id", [owner, category])).rows[0].id;
        let current = prepareCalculation(await input());
        assert.ok(!current.inputJson.includes('Private description'));
        assert.equal(current.input.records[0].amount_pence, 1001);
        assert.equal(current.input.scope!.is_current, false);
        const stamp = (await db.query<{
            s: string;
        }>('select tax_review_stamp(2025) s')).rows[0].s;
        await db.query("select review_tax_inputs(2025,$1,$2,'Synthetic vehicle evidence',$3)", [JSON.stringify({ action: 'fact', expected_ordinal: 0, kind: 'vehicle', label: 'Synthetic actual cost', state: 'verified', data: { vehicle_type: 'car', method: 'actual_costs', business_use_bps: 3000, business_miles_hundredths: null, period_start: '2025-04-06', period_end: '2026-04-05' }, record_ids: [id], document_ids: [], transaction_ids: [] }), stamp, randomUUID()]);
        current = prepareCalculation(await input());
        assert.equal(current.input.sources[0].snapshot.amount_pence, 1001);
        assert.equal(current.input.sources[0].snapshot.amount, undefined);
        await db.exec('reset role');
        await db.query("update record_categories set sa103_box='synthetic-box' where id=$1", [category]);
        await assert.rejects(capture(current), /inputs changed/);
        current = prepareCalculation(await input());
        await db.exec('reset role');
        await db.query('update financial_records set amount=10.02 where id=$1', [id]);
        await assert.rejects(capture(current), /inputs changed/);
        await auth();
        assert.deepEqual((await db.query<{
            v: unknown;
        }>('select input v from tax_calculations where id=$1', [saved])).rows[0].v, prepared.input);
    });
    await serialSubtest(t,'legacy cross-owner category links never expose foreign category metadata', async () => {
        await db.exec('reset role');
        const category = (await db.query<{
            id: string;
        }>("insert into record_categories(user_id,name,record_type,is_default,sa103_box) values ($1,'PRIVATE_FOREIGN_CATEGORY','expense',false,'PRIVATE_FOREIGN_BOX') returning id", [other])).rows[0].id;
        await auth();
        await assert.rejects(db.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',1,'Synthetic legacy cross-owner reference','manual','approved',$2)", [owner, category]), /Category must/);
        const current = await input();
        assert.equal(current.records.some(r => r.amount_pence === 100), false);
        assert.ok(!canonicalJson(current).includes('PRIVATE_FOREIGN'));
    });
    await serialSubtest(t,'reviewed ledger and PAYE facts calculate, capture and replay exact historical results', async () => {
        const user = randomUUID();
        await db.exec('reset role');
        await db.query('insert into auth.users values ($1)', [user]);
        const cat = (await db.query<{
            id: string;
        }>("insert into record_categories(user_id,name,record_type,is_default) values ($1,'Synthetic actual costs','expense',false) returning id", [user])).rows[0].id;
        const cost = (await db.query<{
            id: string;
        }>("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',189.09,'Synthetic apportioned cost','manual','approved',$2) returning id", [user, cat])).rows[0].id;
        for (const amount of ['250.00', '275.00', '1500.00'])
            await db.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status) values ($1,'income','2025-08-01',$2,'Synthetic received cash','manual','approved')", [user, amount]);
        const doc = (await db.query<{
            id: string;
        }>("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,'PRIVATE_PAYE','PRIVATE_KEY') returning id", [user, 'd'.repeat(64)])).rows[0].id;
        await auth(user);
        const stamp = async () => (await db.query<{
            s: string;
        }>('select tax_review_stamp(2025) s')).rows[0].s;
        const review = async (data: unknown) => db.query("select review_tax_inputs(2025,$1,$2,'Reviewed synthetic case',$3)", [JSON.stringify(data), await stamp(), randomUUID()]);
        await review({ action: 'profile', expected_ordinal: 0, state: 'reviewed', data: { jurisdiction: 'england_wales_ni', accounting_basis: 'cash', business_structure: 'sole_trader', vat_registered: 'no', student_loan: 'none', residency: 'uk_full_year', special_reliefs: 'none', ledger_completeness: 'complete' } });
        await review({ action: 'fact', expected_ordinal: 0, kind: 'employment', label: 'Synthetic P45', state: 'verified', data: { taxable_pay_pence: 1403352, income_tax_withheld_pence: 154260, class1_band_earnings_pence: null, statement_basis: 'p45_current_employment', period_start: '2025-04-06', period_end: '2026-04-05' }, record_ids: [], transaction_ids: [], document_ids: [doc] });
        await review({ action: 'fact', expected_ordinal: 0, kind: 'vehicle', label: 'Synthetic actual-cost vehicle', state: 'verified', data: { vehicle_type: 'car', method: 'actual_costs', business_use_bps: 3000, business_miles_hundredths: null, period_start: '2025-04-06', period_end: '2026-04-05' }, record_ids: [cost], transaction_ids: [], document_ids: [] });
        for (const kind of ['employment', 'termination', 'pension', 'other_income', 'tax_payment', 'vehicle', 'gift_aid', 'trade_adjustment'])
            await review({ action: 'section', kind, verdict: ['employment', 'vehicle'].includes(kind) ? 'complete' : 'none' });
        const scope = { assessment_adjustments: 'none', class4_status: 'not_exempt', class2_election: 'no_voluntary_charge', class2_amount_pence: 0, pension_scope: 'none', net_pay_scope: 'not_applicable', employment_scope: 'distinct_employments_cumulative_totals_checked', termination_scope: 'none', payments_scope: 'none', vehicle_scope: 'all_costs_method_history_and_capital_checked', trade_treatment: 'reviewed_no_unmodelled_adjustments', ni_adjustments: 'none', gift_aid_scope: 'none', cash_dates: 'bank_posting_dates_reviewed' };
        await db.query("select review_tax_calculation_scope(2025,0,$1,'reviewed',null,$2,'Reviewed synthetic scope',$3)", [JSON.stringify(scope), await stamp(), randomUUID()]);
        const input = (await db.query<{
            v: CalculationInput;
        }>('select read_tax_calculation_input(2025) v')).rows[0].v, calculated = prepareCalculation(input);
        assert.equal(calculated.result.status, 'estimate');
        assert.equal(calculated.result.totals.income_tax, 65960);
        assert.equal(calculated.result.totals.net_balance, -88300);
        assert.ok(!calculated.inputJson.includes('PRIVATE_'));
        await service();
        const id = (await db.query<{
            id: string;
        }>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) id', [user, calculated.inputJson, calculated.resultJson, calculated.rulesJson, 'Reviewed synthetic integrated result', randomUUID()])).rows[0].id;
        await auth(user);
        const saved = (await db.query<SavedCalculation>('select * from tax_calculations where id=$1', [id])).rows[0];
        assert.equal(canonicalJson(calculateTax(saved.input, rules2025)), saved.result_canonical_json);
        await db.exec('reset role');
        await db.query('update financial_records set amount=190.09 where id=$1', [cost]);
        await auth(user);
        assert.equal((await db.query<{
            v: CalculationInput;
        }>('select read_tax_calculation_input(2025) v')).rows[0].v.scope!.is_current, false);
        assert.equal(canonicalJson(calculateTax(saved.input, rules2025)), saved.result_canonical_json);
        await auth();
    });
    await serialSubtest(t,'rules identifiers cannot acquire different content and late failure leaves no snapshot', async () => {
        const current = prepareCalculation(await input());
        await assert.rejects(capture({ ...current, rulesJson: canonicalJson({ ...current.rules, source_reviewed_at: '2099-01-01' }) }), /different immutable content/);
        await db.exec('reset role');
        await db.exec("create function reject_calculation_test() returns trigger language plpgsql as $$begin raise exception 'Injected audit persistence failure';end$$;create trigger reject_calculation_test before insert on tax_calculations for each row execute function reject_calculation_test();");
        await assert.rejects(capture(current), /Injected audit/);
        await auth();
        assert.equal((await db.query('select id from tax_calculations')).rows.length, 1);
    });
});
