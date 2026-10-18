/** Pure synthetic proposal demo; no database, account, transaction approval or send. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { proposeMerchantRollover, type RolloverRule } from '../lib/records/merchant-rollover';
async function main() {
    const directory = resolve(process.argv[2] ?? '/tmp/vibecount-merchant-rollover-demo');
    const source: RolloverRule = { id: '11111111-1111-4111-8111-111111111111', rule_id: '22222222-2222-4222-8222-222222222222', ordinal: 1,
        match_key: 'synthetic subscription', record_type: 'expense', status: 'active', account_id: null, tax_year_start: 2025,
        effective_from: '2025-04-06', expires_on: '2026-04-05', priority: 50, classification: 'Business', business_use_bps: 10000,
        category_id: 'synthetic-category', evidence_status: 'provisional', seed_transaction_id: '33333333-3333-4333-8333-333333333333', category_valid: true };
    const original = JSON.stringify(source), proposal = proposeMerchantRollover(source, 2026, [source], []);
    if (JSON.stringify(source) !== original || proposal.proposed.status !== 'disabled' || proposal.proposed.account_id !== null) throw new Error('Synthetic proposal did not preserve source/scope.');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'proposal.json'), JSON.stringify({ document_status: 'Draft — not submitted to HMRC', note: 'Synthetic proposal only. Requires fresh human review; no target family or financial decision was saved.', new_postings: 0, source, proposal }, null, 2) + '\n');
    await writeFile(join(directory, 'README.txt'), 'Synthetic annual rollover proposal. Prior-year family and global account scope remain intact. New-year proposal defaults disabled with provisional evidence. No linked documents or transaction approvals carry forward. Run npx tsx --test lib/database/merchant-rollover.test.ts for disposable SQL capture, retry, ownership, both-year suggestion and rollback demonstrations; native races run in lib/database/concurrency.test.ts.\n');
    console.log('Verified disabled synthetic proposal; zero postings: ' + directory);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
