/** Synthetic local calculations only; never opens a database or invokes a financial action. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareFinancePlan, verifyFinancePlan, type LegacySavedFinancePlan } from '../lib/finance/snapshot';
import type { Plan } from '../lib/finance/plan';
import { formatPounds, signedAmountToWords } from '../lib/invoices/money';

async function main() {
    const directory = resolve(process.argv[2] ?? '/tmp/vibecount-finance-plan-demo');
    const plan: Plan = {
        schema_version: 'finance-plan/1', as_of: '2026-10-17',
        assets: [
            { id: 'synthetic-bank', label: 'Synthetic accessible bank', kind: 'cash', balance_pence: 3000000, account_id: null, document_id: null },
            { id: 'synthetic-pension', label: 'Synthetic inaccessible pension', kind: 'pension', balance_pence: 4305500, account_id: null, document_id: null },
        ],
        earmarks: [
            { id: 'synthetic-tax', asset_id: 'synthetic-bank', purpose: 'tax_reserve', tax_year_start: null, amount_pence: 592439 },
            { id: 'synthetic-business', asset_id: 'synthetic-bank', purpose: 'business_buffer', tax_year_start: null, amount_pence: 900000 },
            { id: 'synthetic-emergency', asset_id: 'synthetic-bank', purpose: 'emergency_buffer', tax_year_start: null, amount_pence: 680000 },
        ], obligations: [], cash_complete: true, unique_assets_checked: true, commitments_complete: true, cashflow_assumptions_checked: true,
        forecast: { tax_year_start: 2026, jurisdiction: 'england_wales_ni', annual_turnover_pence: 4000000, monthly_costs_pence: 40000,
            monthly_pension_pence: 46000, pension_basis: 'net_ras', pension_eligibility_checked: true, supported_tax_scope_checked: true,
            class2_election: 'no_voluntary_charge', tax_paid_pence: 0, tax_payments_checked: true, monthly_drawings_pence: 100000,
            billable_days_per_year: 100, daily_rate_pence: 40000 },
    };
    await mkdir(directory, { recursive: true });
    for (const scenario of ['unresolved-reserve-year', 'synthetic-resolved-reserve-year']) {
        if (scenario === 'synthetic-resolved-reserve-year') plan.earmarks[0].tax_year_start = 2026;
        const p = prepareFinancePlan('synthetic-owner', plan, plan.as_of, { accounts: [], documents: [] });
        const saved: LegacySavedFinancePlan = { input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson,
            rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
        const verified = verifyFinancePlan(saved, 'synthetic-owner');
        await writeFile(join(directory, scenario + '.json'), JSON.stringify(saved, null, 2) + '\n');
        const ceiling = verified.result.additional_drawings_ceiling_pence;
        console.log(`${scenario}: ${ceiling === null ? 'drawings withheld' : formatPounds(ceiling) + ' (' + signedAmountToWords(ceiling) + ') conditional additional drawings ceiling'}`);
    }
    await writeFile(join(directory, 'README.txt'), 'SYNTHETIC engineering demo only. £30,000 cash is invented, not inferred from handover receipts or buffers. The unresolved reserve year blocks drawings. The resolved scenario assigns 2026 only as an explicit hypothetical choice, not a determination about the actual £5,924.39. Pension is inaccessible. All assets are manually transcribed synthetic values. Existing liabilities/other obligations are explicitly zero for this example. No database, account, payment, tax fact or financial record is changed. Snapshot hashes and replay prove deterministic computation, not evidence authenticity or tax certification.\n');
    console.log('Verified local draft snapshots: ' + directory);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
