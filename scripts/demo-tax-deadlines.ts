/** Synthetic dates only. Does not connect to a database, install a calendar or send a reminder. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { emptyDeadlinePlan } from '../lib/finance/deadlines/model';
import { deadlineCatalogFromPlan, prepareDeadlineSnapshot, verifyDeadlineSnapshot, type SavedDeadlineSnapshot } from '../lib/finance/deadlines/snapshot';

async function main() {
    const directory = resolve(process.argv[2] ?? '/tmp/vibecount-tax-deadlines-demo');
    const owner = '10000000-0000-4000-8000-000000000001';
    const catalog = deadlineCatalogFromPlan(owner, 2025, null, []), plan = emptyDeadlinePlan(2025, catalog);
    await mkdir(directory, { recursive: true });
    for (const scenario of ['unreviewed-calendar', 'synthetic-online-reminder']) {
        if (scenario === 'synthetic-online-reminder') Object.assign(plan.entries.find(e => e.id === 'calendar:online')!, { applicability: 'applies', date_basis: 'standard' });
        const p = prepareDeadlineSnapshot(owner, plan, '2027-01-17', catalog);
        const row: SavedDeadlineSnapshot = { input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
        const verified = verifyDeadlineSnapshot(row, owner, catalog);
        if (verified.result.items.some(i => i.amount_pence !== null)) throw new Error('A calendar proposal invented a demand.');
        await writeFile(join(directory, scenario + '.json'), JSON.stringify(verified, null, 2) + '\n');
        console.log(`${scenario}: ${verified.result.active_count} active in-memory reminder(s); all payment amounts unknown; zero financial effects.`);
    }
    await writeFile(join(directory, 'README.txt'), 'SYNTHETIC model/snapshot demonstration, not a persisted notification or actual taxpayer decision. General dates need personal applicability/notice review. The first snapshot leaves every proposal unknown; the second hypothetically enables only the ordinary online-return reminder. Payment dates contain no amounts, no filing/payment state is established, and no calendar, provider, database or financial account is touched. Rules and source review are retained; independent tax review is pending.\n');
    console.log('Verified local deadline snapshots: ' + directory);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
