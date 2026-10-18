// Synthetic deadline review with inert save action; no real reminder, filing or payment.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', stdin: { resolveDir: process.cwd(), sourcefile: 'deadline-ui-fixture.jsx', loader: 'jsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import DeadlineReview from './app/dashboard/finance/deadlines/DeadlineReview.tsx';import {emptyDeadlinePlan} from './lib/finance/deadlines/model.ts';
const owner='10000000-0000-4000-8000-000000000001',doc='30000000-0000-4000-8000-000000000003';
const catalog={owner_id:owner,finance_plan:{id:'40000000-0000-4000-8000-000000000004',user_id:owner,ordinal:1,as_of:'2026-10-17',input_sha256:'a'.repeat(64),result_sha256:'b'.repeat(64)},obligations:[{id:'zero',label:'Synthetic zero commitment',tax_year_start:2025,due_date:'2027-01-31',amount_pence:0},{id:'unknown',label:'Synthetic unknown amount',tax_year_start:2025,due_date:'2027-01-31',amount_pence:null}],unassigned_tax_obligations:0,documents:[{id:doc,user_id:owner,file_sha256:'c'.repeat(64)}]};
function Fixture(){const [version,setVersion]=React.useState(0);return <><button data-testid="deadline-refresh" onClick={()=>setVersion(version+1)}>New source context</button><DeadlineReview initial={emptyDeadlinePlan(2025,catalog)} catalog={catalog} today="2027-01-17" expected={version} stamp={String(version).repeat(32)} requestId="20000000-0000-4000-8000-000000000002" rulesHash={'d'.repeat(64)}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);` }, plugins: [{ name: 'inert-deadline-actions', setup(b) { b.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'actions', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export async function reviewTaxDeadlines(form){window.savedDeadline=Object.fromEntries(form.entries())}' })); } }] });
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><title>Synthetic deadline review</title></head><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
try {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; browser = await chromium.launch({ headless: true, executablePath: process.env.VIBECOUNT_TEST_BROWSER || (existsSync(chrome) ? chrome : undefined) });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('http://127.0.0.1:' + server.address().port);
    const save = page.getByTestId('deadline-save'), confirm = page.getByTestId('deadline-confirm'), reason = page.getByTestId('deadline-reason');
    assert.equal(await save.isDisabled(), true); assert.equal(await page.getByTestId('deadline-applicability-calendar:online').inputValue(), 'unknown');
    assert.ok((await page.getByTestId('deadline-readback-commitment:zero').innerText()).includes('£0.00 (zero pounds)'));
    assert.ok((await page.getByTestId('deadline-readback-commitment:unknown').innerText()).includes('amount unknown'));
    assert.ok((await page.getByTestId('deadline-readback-calendar:online').innerText()).includes('no amount established'));
    await reason.fill('Synthetic applicability and date review'); await page.getByTestId('deadline-applicability-calendar:online').selectOption('applies');
    assert.ok((await page.getByTestId('deadline-readback-calendar:online').innerText()).includes('Review the applicable date'));
    await page.getByTestId('deadline-basis-calendar:online').selectOption('standard'); await confirm.check(); assert.equal(await save.isEnabled(), true);
    await page.getByTestId('deadline-lead-calendar:online').selectOption('7'); assert.equal(await confirm.isChecked(), false);
    assert.ok((await page.getByTestId('deadline-readback-calendar:online').innerText()).includes('Scheduled in-app reminder'));
    await confirm.check(); await reason.fill('Changed reason'); assert.equal(await confirm.isChecked(), false);
    await page.getByTestId('deadline-basis-calendar:online').selectOption('notice'); assert.equal(await confirm.isDisabled(), true); assert.equal(await save.isDisabled(), true);
    await page.getByTestId('deadline-notice-date-calendar:online').fill('2027-02-15'); assert.equal(await confirm.isDisabled(), true);
    await page.getByTestId('deadline-notice-document-calendar:online').selectOption('30000000-0000-4000-8000-000000000003'); await confirm.check();
    await page.getByTestId('deadline-disposition-calendar:online').selectOption('acknowledged'); assert.equal(await confirm.isChecked(), false);
    assert.ok((await page.getByTestId('deadline-readback-calendar:online').innerText()).includes('Reminder handled — payment and filing status not established'));
    await confirm.check(); await page.getByTestId('deadline-refresh').click(); assert.equal(await confirm.isChecked(), false); assert.equal(await save.isDisabled(), true);
    assert.equal(await page.getByTestId('deadline-applicability-calendar:online').inputValue(), 'unknown'); assert.equal(await reason.inputValue(), '');
    await reason.fill('Synthetic review retaining unknowns'); await confirm.check(); await save.click(); await page.waitForFunction(() => window.savedDeadline);
    const submitted = await page.evaluate(() => window.savedDeadline); assert.equal(submitted.humanConfirmed, 'yes'); assert.equal(submitted.year, '2025');
    assert.equal(JSON.parse(submitted.plan).entries.every(e => e.applicability === 'unknown'), true); assert.equal(JSON.parse(submitted.preview).active_count, 0); assert.deepEqual(errors, []);
    console.log('PASS: deadline applicability/date/evidence review, unknown/zero figures and words, acknowledgement meaning, confirmation reset and explicit inert save.');
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
