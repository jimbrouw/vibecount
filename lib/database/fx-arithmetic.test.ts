import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { convertCurrencyMinor, convertCurrencyTranche, currencyAmount, FX_CURRENCIES, FX_CURRENCY_RULESET, FX_CURRENCY_SOURCE, FX_ROUNDING, fxRate, rateFromDecimal, type CurrencyCode } from '../fx/currency';

test('FX arithmetic SQL matches exact currency models without enabling foreign financial writes', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    // This is the foundation's predecessor contract. Later reviewed external-document
    // capture intentionally replaces the invoice constraint; its upgrade/native parity
    // is exercised in external-invoices.test.ts against the complete chain.
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n <= '20261018120000_fx_arithmetic_foundation.sql').sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const definition = (await db.query<{ definition: Record<string, unknown> }>('select definition from fx_currency_rulesets where id=$1', [FX_CURRENCY_RULESET])).rows[0].definition;
    assert.deepEqual(definition.currencies, FX_CURRENCIES); assert.deepEqual(definition.source, FX_CURRENCY_SOURCE); assert.equal(definition.rounding, FX_ROUNDING);
    for (const [code, value] of [['GBP', '14033.52'], ['USD', '-630.29'], ['EUR', '-0.00'], ['JPY', '123'], ['KWD', '1.234'], ['GBP', '9999999999.99']] as [CurrencyCode, string][]) {
        const n = (await db.query<{ n: string }>('select fx_decimal_to_minor($1,$2,$3)::text n', [value, code, FX_CURRENCY_RULESET])).rows[0].n;
        assert.equal(Number(n), currencyAmount(value, code));
    }
    const convert = async (n: number, rate: unknown) => (await db.query<{ result: unknown }>('select fx_convert_minor($1,$2,$3) result', [n, JSON.stringify(rate), FX_CURRENCY_RULESET])).rows[0].result;
    const pairs: [CurrencyCode, CurrencyCode, string][] = [['USD', 'GBP', '0.79'], ['JPY', 'GBP', '0.005'], ['GBP', 'JPY', '200'], ['KWD', 'GBP', '2.5'], ['EUR', 'USD', '1.2345678901234567']];
    for (const [source, target, decimal] of pairs) for (const amount of [0, 1, -1, 2, -2, 1234, -1234, 100000]) {
        const rate = rateFromDecimal(source, target, decimal); assert.deepEqual(await convert(amount, rate), convertCurrencyMinor(amount, rate));
    }
    for (const numerator of ['499999999999999999', '500000000000000000']) for (const amount of [1, -1]) {
        const rate = fxRate({ direction: 'target_major_per_source_major', source_currency: 'USD', target_currency: 'GBP', numerator, denominator: '999999999999999999' });
        assert.deepEqual(await convert(amount, rate), convertCurrencyMinor(amount, rate));
    }
    for (let numerator = 1; numerator <= 7; numerator++) for (let denominator = 1; denominator <= 9; denominator++) {
        const rate = fxRate({ direction: 'target_major_per_source_major', source_currency: 'USD', target_currency: 'GBP', numerator: String(numerator), denominator: String(denominator) });
        for (const portion of [1, -1]) {
            const prior = convertCurrencyMinor(portion, rate).target_minor;
            const sql = (await db.query<{ result: unknown }>('select fx_convert_tranche($1,$2,$3,$4,$5) result', [JSON.stringify(rate), portion, prior, portion, FX_CURRENCY_RULESET])).rows[0].result;
            assert.deepEqual(sql, convertCurrencyTranche(rate, portion, prior, portion));
        }
    }
    const rate = rateFromDecimal('USD', 'GBP', '0.5');
    for (const n of [null, 1000000000000, -1000000000000]) await assert.rejects(db.query('select fx_convert_minor($1,$2,$3)', [n, JSON.stringify(rate), FX_CURRENCY_RULESET]));
    for (const patch of [{ denominator: '0' }, { numerator: '01' }, { numerator: '1\n' }, { numerator: '-1' }, { numerator: '1'.repeat(10000) }, { numerator: 1 }, { raw: 'PRIVATE' }, { direction: 'source_per_target' }, { source_currency: '__proto__' }]) await assert.rejects(convert(1, { ...rate, ...patch }));
    for (const [value, code] of [['1.0', 'JPY'], ['1.001', 'GBP'], [' 1', 'GBP'], ['1\n', 'GBP'], ['1e3', 'GBP'], ['1'.repeat(10000), 'GBP'], ['1', '__proto__'], ['1', 'gbp'], [null, 'GBP']]) await assert.rejects(db.query('select fx_decimal_to_minor($1,$2,$3)', [value, code, FX_CURRENCY_RULESET]));
    await assert.rejects(db.query('select fx_convert_tranche($1,1,0,1,$2)', [JSON.stringify(rate), FX_CURRENCY_RULESET]));
    await assert.rejects(db.query('select fx_convert_tranche($1,1,1,-1,$2)', [JSON.stringify(rate), FX_CURRENCY_RULESET]));
    await assert.rejects(db.query("update fx_currency_rulesets set definition='{}' where id=$1", [FX_CURRENCY_RULESET]), /Preserve|immutable/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
        await db.exec('reset role'); await db.exec('set role ' + role);
        if (role === 'anon') await assert.rejects(db.query('select * from fx_currency_rulesets'), /permission denied/);
        else assert.equal((await db.query('select * from fx_currency_rulesets')).rows.length, 1);
        await assert.rejects(convert(1, rate), /permission denied/);
        await assert.rejects(db.query("insert into fx_currency_rulesets(id,definition) values('unreviewed','{}')"), /permission denied/);
    }
    await db.exec('reset role');
    // Foundation must not silently enable non-GBP sources or invoices.
    const constraints = (await db.query<{ relation:string;definition:string }>("select c.relname relation,pg_get_constraintdef(p.oid) definition from pg_constraint p join pg_class c on c.oid=p.conrelid where p.conrelid in('public.financial_accounts'::regclass,'public.bank_transactions'::regclass,'public.invoices'::regclass) and p.contype='c'")).rows;
    for(const table of ['financial_accounts','bank_transactions','invoices'])assert.ok(constraints.some(c=>c.relation===table&&c.definition==="CHECK ((currency = 'GBP'::text))"),'Preserve the explicit GBP-only guard for '+table);
});
