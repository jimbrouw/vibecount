// Synthetic browser review only; server actions are inert and create no financial effects.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    stdin: { resolveDir: process.cwd(), sourcefile: 'finance-ui-fixture.jsx', loader: 'jsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import FinanceReview from './app/dashboard/finance/FinanceReview.tsx';
import {bankSourceCoverageFixture} from './lib/records/bank-source-coverage-fixture.ts';
import {financeFixture} from './lib/finance/test-fixture.ts';
const baseCoverage={schema_version:'vibecount.invoice-currency-coverage/1',scope:'all_owned_finalised_invoices_not_tax_year_income',owner_id:'00000000-0000-4000-8000-000000000001',stamp:'a'.repeat(64),invoice_count:0,native_invoice_count:0,unsupported_external_invoice_count:0,invalid_invoice_count:0,draft_invoice_count:0,invoices:[]};
function coverage(blocked,malformed){return malformed?{...baseCoverage,stamp:'d'.repeat(64),invoice_count:1}:blocked?{...baseCoverage,stamp:'c'.repeat(64),invoice_count:1,unsupported_external_invoice_count:1,invoices:[{id:'11111111-1111-4111-8111-111111111111',status:'finalised',origin:'preserved_external',currency:'KWD',invoice_date:'2024-04-05',amount:null,original_total_minor:'10001',currency_ruleset_id:'vibecount-currencies/1',source_fact_revision_id:'22222222-2222-4222-8222-222222222222',source_fact_family_id:'33333333-3333-4333-8333-333333333333',native_balance_available:false,representation:'unsupported_external'}]}:baseCoverage}
function Fixture(){const [revision,setRevision]=React.useState(0),[blocked,setBlocked]=React.useState(false),[malformed,setMalformed]=React.useState(false),[bankBlocked,setBankBlocked]=React.useState(false);const bank=bankSourceCoverageFixture();if(bankBlocked){bank.stamp='b'.repeat(64);bank.accounts=[{id:'00000000-0000-4000-8000-000000000020',currency:'USD',representation:'foreign'}];bank.counts.accounts=bank.counts.foreign_accounts=1;}return <><button data-testid="changed-finance-context" onClick={()=>setRevision(revision+1)}>Changed source context</button><button data-testid="unsupported-finance-bank" onClick={()=>setBankBlocked(!bankBlocked)}>Changed bank coverage</button><button data-testid="unsupported-finance-coverage" onClick={()=>setBlocked(true)}>Unsupported invoice coverage</button><button data-testid="malformed-finance-coverage" onClick={()=>setMalformed(true)}>Malformed fixture coverage</button><FinanceReview owner="00000000-0000-4000-8000-000000000001" bankCoverage={bank} invoiceCoverage={coverage(blocked,malformed)} initial={financeFixture('2026-10-17')} catalog={{accounts:[],documents:[]}} today="2026-10-17" expected={revision} stamp={'context-'+revision} requestId="11111111-1111-4111-8111-111111111111" rulesHash={'a'.repeat(64)}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);` },
    plugins: [{ name: 'inert-finance-action', setup(b) { b.onResolve({ filter: /^(\.\/actions|next\/link)$/ }, a => ({ path: a.path === 'next/link' ? 'link' : 'finance-action', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'jsx', resolveDir: process.cwd(), contents: a.path === 'link' ? "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}" : 'export async function reviewFinancePlan(){window.financeSubmissions=(window.financeSubmissions||0)+1}' })); } }],
});
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><title>Synthetic cash plan review</title></head><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, executablePath: process.env.VIBECOUNT_TEST_BROWSER || (existsSync(chrome) ? chrome : undefined) });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    const save = page.getByTestId('finance-save'), confirm = page.getByTestId('finance-confirm');
    assert.equal(await save.isDisabled(), true);
    assert.ok((await page.getByTestId('finance-readback').innerText()).includes('£43,055.00'));
    assert.ok((await page.getByTestId('finance-readback').innerText()).includes('Pension assets — inaccessible'));
    assert.ok((await page.getByTestId('finance-readback').innerText()).includes('forty-three thousand fifty-five pounds'));
    await page.getByTestId('finance-reason').fill('Reviewed synthetic cash assumptions'); await confirm.check();
    assert.equal(await save.isEnabled(), true);
    await page.getByTestId('finance-monthly_costs_pence').fill('400.001');
    assert.equal(await confirm.isChecked(), false); assert.equal(await save.isDisabled(), true);
    assert.ok((await page.getByTestId('finance-invalid').innerText()).includes('invalid monetary'));
    await page.getByTestId('finance-monthly_costs_pence').fill('400.00'); await confirm.check();
    await page.getByTestId('finance-earmark-year-synthetic-reserve').fill('');
    assert.equal(await confirm.isChecked(), false);
    assert.ok((await page.getByTestId('finance-issues').innerText()).includes('Allocate actual tax cash'));
    assert.ok((await page.getByTestId('finance-readback').innerText()).includes('drawings withheld'));
    await page.getByTestId('finance-earmark-year-synthetic-reserve').fill('2026');
    await page.getByTestId('finance-pension-basis').selectOption('unknown');
    assert.ok((await page.getByTestId('finance-issues').innerText()).includes('net cash or gross'));
    await page.getByTestId('finance-pension-basis').selectOption('net_ras');
    await page.getByTestId('finance-as-of').fill('2026-10-16');
    assert.ok((await page.getByTestId('finance-issues').innerText()).includes('Refresh balances'));
    await page.getByTestId('finance-as-of').fill('2026-10-17');
    await page.getByTestId('finance-asset-amount-synthetic-cash').fill('1');
    assert.ok((await page.getByTestId('finance-invalid').innerText()).includes('fit the physical cash'));
    await page.getByTestId('finance-asset-amount-synthetic-cash').fill('30000');
    await page.getByTestId('finance-annual_turnover_pence').fill('');
    assert.ok((await page.getByTestId('finance-issues').innerText()).includes('missing is not zero'));
    await page.getByTestId('finance-annual_turnover_pence').fill('0');
    assert.ok((await page.getByTestId('finance-issues').innerText()).includes('trading loss'));
    await page.getByTestId('finance-annual_turnover_pence').fill('40000');
    await page.getByTestId('finance-monthly_drawings_pence').fill('10000');
    assert.ok((await page.getByTestId('finance-shortfall').innerText()).includes('Cash shortfall'));
    await page.getByTestId('finance-monthly_drawings_pence').fill('1000');
    await confirm.check(); await page.getByTestId('changed-finance-context').click();
    assert.equal(await confirm.isChecked(), false); assert.equal(await save.isDisabled(), true);
    await page.getByTestId('finance-reason').fill('Final synthetic review'); await confirm.check();
    const preview = JSON.parse(await page.locator('input[name="preview"]').inputValue());
    assert.equal(preview.schema_version, 'finance-plan-result/3');assert.equal(preview.scenario.pension_assets_pence, 4305500); assert.equal(preview.scenario.actual_cash_pence, 3000000);
    await save.click(); await page.waitForFunction(() => window.financeSubmissions === 1);
    await confirm.check();await page.getByTestId('unsupported-finance-bank').click();
    assert.equal(await confirm.isChecked(),false);assert.equal(await save.isDisabled(),true);
    assert.match(await page.getByTestId('bank-source-coverage-status').innerText(),/1 foreign accounts/);
    assert.equal(await page.getByTestId('finance-current-free-cash').innerText(),'Unresolved');assert.equal(await page.getByTestId('finance-drawings-ceiling').innerText(),'Unresolved');
    const bankWithheld=JSON.parse(await page.locator('input[name="preview"]').inputValue());assert.equal(bankWithheld.schema_version,'finance-plan-result/3');assert.equal(bankWithheld.bank_coverage_stamp,'b'.repeat(64));assert.equal(bankWithheld.status,'incomplete');assert.equal(bankWithheld.scenario.actual_cash_pence,3000000);
    await confirm.check();await page.getByTestId('unsupported-finance-bank').click();assert.equal(await confirm.isChecked(),false);
    await page.getByTestId('unsupported-finance-coverage').click();
    assert.equal(await confirm.isChecked(),false);assert.equal(await save.isDisabled(),true);
    assert.match(await page.getByTestId('finance-invoice-currency-coverage').innerText(),/KWD 10.001.*ten Kuwaiti dinars and one fil/);
    assert.equal(await page.getByTestId('finance-drawings-ceiling').innerText(),'Unresolved');assert.equal(await page.getByTestId('finance-current-free-cash').innerText(),'Unresolved');
    assert.match(await page.getByTestId('finance-issues').innerText(),/External or invalid invoice/);
    const withheld=JSON.parse(await page.locator('input[name="preview"]').inputValue());
    assert.equal(withheld.status,'incomplete');assert.equal(withheld.additional_drawings_ceiling_pence,null);assert.equal(withheld.current_free_cash_pence,null);
    assert.equal(withheld.scenario.actual_cash_pence,3000000);assert.ok(withheld.scenario.additional_drawings_ceiling_pence>0);
    await page.getByTestId('finance-reason').fill('Reviewed unresolved synthetic coverage');await confirm.check();await save.click();await page.waitForFunction(()=>window.financeSubmissions===2);
    await page.getByTestId('malformed-finance-coverage').click();assert.equal(await save.isDisabled(),true);assert.equal(await page.getByTestId('finance-readback').count(),0);assert.match(await page.getByTestId('finance-invalid').innerText(),/coverage counts/);
    assert.deepEqual(errors, []);
    console.log('PASS: cash/pension separation, figures/words, invalid/missing/zero inputs, reserve-year and stale-balance gates, confirmation reset, versioned currency coverage, withheld current drawings, malformed-context denial and explicit incomplete draft save.');
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
