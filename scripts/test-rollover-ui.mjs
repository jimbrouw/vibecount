// Synthetic annual rollover form, with inert actions. No financial decision or real rule is saved.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', stdin: { resolveDir: process.cwd(), sourcefile: 'rollover-ui-fixture.jsx', loader: 'jsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {MerchantRuleReview} from './app/dashboard/review/memory/MerchantReview.tsx';
const seed={id:'33333333-3333-4333-8333-333333333333',account_id:'bank',tax_year_start:2025,signed_amount_pence:-63029,currency:'GBP',original_signed_minor:null,source_units_ruleset:null,merchant_key:'synthetic repair'};
const rule={id:'source',rule_id:'source-family',ordinal:0,match_key:'synthetic repair',record_type:'expense',status:'disabled',account_id:null,tax_year_start:2026,effective_from:'2026-04-06',expires_on:'2027-04-05',priority:50,classification:'Mixed',business_use_bps:3000,category_id:'expense',evidence_status:'provisional',seed_transaction_id:seed.id,category_valid:true};
function Fixture(){const [revision,setRevision]=React.useState(0);return <><button data-testid="rollover-new-context" onClick={()=>setRevision(revision+1)}>Changed source/target context</button><MerchantRuleReview seed={seed} rule={rule} categories={[{id:'expense',name:'Synthetic repairs',record_type:'expense'}]} accounts={[{id:'bank',label:'Synthetic bank',masked_identifier:'1234'}]} stamp={'stamp-'+revision} requestId="11111111-1111-4111-8111-111111111111" reviewYear={2026} rollover={{sourceVersionId:'22222222-2222-4222-8222-222222222222',targetYear:2026,conflicts:revision?[]:[{effective_from:'2026-04-06',expires_on:'2026-06-30'}]}}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);` }, plugins: [{ name: 'inert-rollover-actions', setup(b) { b.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'actions', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export async function saveMerchantRule(){};export async function approveMerchantBatch(){};export async function undoMerchantBatch(){};export async function saveMerchantRollover(form){window.savedRollover=Object.fromEntries(form.entries())}' })); } }] });
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><title>Synthetic annual rule review</title></head><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; browser = await chromium.launch({ headless: true, executablePath: process.env.VIBECOUNT_TEST_BROWSER || (existsSync(chrome) ? chrome : undefined) });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('http://127.0.0.1:' + server.address().port);
    const submit = page.getByTestId('merchant-submit'), confirm = page.getByTestId('merchant-confirm');
    assert.equal(await page.getByTestId('merchant-rule-account').inputValue(), ''); assert.equal(await page.getByTestId('merchant-rule-account').isDisabled(), true);
    assert.equal(await page.getByTestId('merchant-rule-year').getAttribute('readonly'), ''); assert.equal(await page.getByTestId('merchant-rule-year').inputValue(), '2026');
    assert.equal(await page.getByTestId('merchant-rule-status').inputValue(), 'disabled'); assert.equal(await submit.isDisabled(), true);
    assert.ok((await page.getByTestId('merchant-rollover-readback').innerText()).includes('prior-year family and decisions remain unchanged'));
    assert.ok((await page.getByTestId('merchant-rule-readback').innerText()).includes('£0.00 (zero pounds)'));
    assert.equal(await confirm.isDisabled(), true); // Existing Apr–June scope overlaps the default window.
    await page.getByTestId('merchant-rule-effective').fill('2026-07-01'); await page.getByTestId('merchant-rule-reason').fill('Synthetic new-year eligibility and date review'); await confirm.check();
    assert.equal(await submit.isEnabled(), true);
    await page.getByTestId('merchant-rule-status').selectOption('active'); assert.equal(await confirm.isChecked(), false);
    await confirm.check(); await page.getByTestId('merchant-rule-percent').fill('45'); assert.equal(await confirm.isChecked(), false);
    assert.ok((await page.getByTestId('merchant-rule-readback').innerText()).includes('at 45%'));
    await page.getByTestId('merchant-rule-expiry').fill('2027-04-06'); assert.equal(await submit.isDisabled(), true);
    await page.getByTestId('merchant-rule-expiry').fill('2027-04-05'); await confirm.check();
    await page.getByTestId('rollover-new-context').click(); assert.equal(await confirm.isChecked(), false); assert.equal(await submit.isDisabled(), true);
    assert.equal(await page.getByTestId('merchant-rule-status').inputValue(), 'disabled');
    await page.getByTestId('merchant-rule-reason').fill('Final synthetic review'); await confirm.check(); await submit.click(); await page.waitForFunction(() => window.savedRollover);
    const saved = await page.evaluate(() => window.savedRollover), definition = JSON.parse(saved.definition);
    assert.equal(definition.account_id, null); assert.equal(definition.tax_year_start, 2026); assert.equal(definition.status, 'disabled');
    assert.equal(definition.evidence_status, 'provisional'); assert.equal(saved.sourceVersionId, '22222222-2222-4222-8222-222222222222');
    assert.equal(saved.targetYear, '2026'); assert.equal(saved.humanConfirmed, 'yes'); assert.deepEqual(errors, []);
    console.log('PASS: annual rollover defaults disabled, preserves global account/year scope, allows non-overlap date review, resets confirmation and submits explicit zero-effect intent.');
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
