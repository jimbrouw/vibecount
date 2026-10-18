import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxSettlementFixture } from '../lib/fx/fixture';
import { fxSettlementReview } from '../lib/fx/settlement';
import { convertCurrencyMinor, convertCurrencyTranche, FX_CURRENCY_RULESET, FX_CURRENCY_SOURCE, rateFromDecimal } from '../lib/fx/currency';

async function main() {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
        await db.exec(TEST_SCHEMA_BOOTSTRAP);
        const dir = new URL('../supabase/migrations/', import.meta.url);
        for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
        const f = fxSettlementFixture(), review = fxSettlementReview(f.owner, f.intent, f.catalog);
        const sql = (await db.query<{ result: unknown }>('select fx_convert_minor(100000,$1,$2) result', [JSON.stringify(f.intent.allocations[0].rate), FX_CURRENCY_RULESET])).rows[0].result;
        assert.deepEqual(sql, convertCurrencyMinor(100000, f.intent.allocations[0].rate));
        assert.equal(review.result.allocated_cash_minor, 79000); assert.equal(review.result.recognized_income_change_pence, 0);
        const rate = rateFromDecimal('USD', 'GBP', '0.5'), finalPortion = convertCurrencyTranche(rate, 1, 1, 1);
        assert.equal(finalPortion.portion_target_minor, 0);
        const records = (await db.query<{ n: number }>('select count(*)::integer n from financial_records')).rows[0].n; assert.equal(records, 0);
        const out = '/tmp/vibecount-fx-foundation-demo'; await mkdir(out, { recursive: true });
        await writeFile(out + '/synthetic-fx-preview.json', JSON.stringify({ synthetic_only: true, arithmetic_source: FX_CURRENCY_SOURCE, preview: review, sql_arithmetic: sql, cumulative_final_portion: finalPortion, financial_records_created: records }, null, 2) + '\n');
        await writeFile(out + '/README.md', '# Synthetic FX arithmetic and review foundation\n\nA USD 1,000 invoice previews GBP £790 actual cash discharge with zero new income. TypeScript and actual private PostgreSQL arithmetic agree. Two one-cent portions at one-half rate retain one penny and a final zero-penny portion.\n\nNo FX settlement writer or human application workflow exists yet. Source/evidence IDs, document hashes and reviewed states here are synthetic placeholders, not authenticated source evidence. The SQL helpers are private, and existing source/invoice GBP constraints remain. This demo approves no records and connects to no external provider or real financial account.\n');
        console.log('Verified synthetic FX arithmetic/review foundation:', out);
    } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
