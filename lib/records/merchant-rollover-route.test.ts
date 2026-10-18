import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = '11111111-1111-4111-8111-111111111111', family = '22222222-2222-4222-8222-222222222222', seedId = '33333333-3333-4333-8333-333333333333', targetRule = '44444444-4444-4444-8444-444444444444';
const rule = { id: source, rule_id: family, ordinal: 1, match_key: 'Synthetic software', record_type: 'expense', status: 'active', account_id: null, tax_year_start: 2025, effective_from: '2025-04-06', expires_on: '2026-04-05', priority: 50, classification: 'Business', business_use_bps: 10000, category_id: 'expense', evidence_status: 'provisional', seed_transaction_id: seedId, category_valid: true };
test('rollover action authenticates and binds explicit human intent to the dedicated RPC', async () => {
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {saveMerchantRollover} from './app/dashboard/review/memory/actions.ts';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-rollover-action', setup(b) {
        b.onResolve({ filter: /^(next\/(cache|navigation)|@\/lib\/supabase\/server|test:db)$/ }, a => ({ path: a.path.startsWith('next/') ? a.path : 'db', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : `export const fixture={signedIn:true,calls:[],fail:false};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:{rule_id:'${targetRule}'},error:fixture.fail?{}:null}}}}` }));
    } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')), f = m.fixture;
    const form = new FormData(); for (const [k, v] of Object.entries({ stamp: 'a'.repeat(32), requestId: randomUUID(), reason: 'Reviewed annual scope', sourceVersionId: source, targetYear: '2026', definition: JSON.stringify({ seed_id: seedId, tax_year_start: 2026 }) })) form.set(k, v);
    f.signedIn = false; await assert.rejects(m.saveMerchantRollover(form), /REDIRECT:\/login/); assert.equal(f.calls.length, 0);
    f.signedIn = true; await assert.rejects(m.saveMerchantRollover(form), /Review%20the%20full/); assert.equal(f.calls.length, 0);
    form.set('humanConfirmed', 'yes'); const invalid = new FormData(); for (const [k, v] of form) invalid.set(k, v); invalid.set('sourceVersionId', 'foreign-shape');
    await assert.rejects(m.saveMerchantRollover(invalid), /error=/); assert.equal(f.calls.length, 0);
    await assert.rejects(m.saveMerchantRollover(form), new RegExp('target=2026&saved=' + targetRule));
    assert.equal(f.calls[0].name, 'rollover_merchant_rule'); assert.equal(f.calls[0].args.p_source_version, source); assert.equal(f.calls[0].args.p_target_year, 2026);
    assert.deepEqual(f.calls[0].args.p_definition, JSON.parse(String(form.get('definition'))));
    f.fail = true; await assert.rejects(m.saveMerchantRollover(form), /error=/);
});
test('rollover page reads complete source/target context and withholds the form after stamp drift', async () => {
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', stdin: { resolveDir: root, contents: "export {default as Page} from './app/dashboard/review/memory/rollover/page.tsx';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-rollover-page', setup(b) {
        b.onResolve({ filter: /^(next\/(navigation|link)|@\/lib\/supabase\/server|test:db|\.\.\/MerchantReview)$/ }, a => ({ path: a.path.startsWith('next/') || a.path === '../MerchantReview' ? a.path : 'db', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'jsx', resolveDir: root, contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/link' ? "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}" : a.path === '../MerchantReview' ? "import React from 'react';export function MerchantRuleReview(){return <div data-testid='rollover-editor-visible'/>}" : `export const fixture={signedIn:true,drift:false,stamps:0,reads:[],rule:${JSON.stringify(rule)}};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},rpc:async()=>({data:(fixture.drift&&fixture.stamps++?'b':'a').repeat(32),error:null}),from(table){let after=null,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},or(){return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},maybeSingle(){return Promise.resolve({data:{id:'${seedId}',account_id:'bank',signed_amount_pence:-1250,tax_year_start:2025,import_status:'review',dedupe_status:'clear'},error:null})},then(resolve){fixture.reads.push({table,after,filters});return Promise.resolve({data:table==='current_merchant_rules'&&!after?[fixture.rule]:[],error:null}).then(resolve)}};return q}}}` }));
    } }] });
    const directory = await mkdtemp(root + '/.rollover-page-test-');
    try {
        const path = directory + '/bundle.mjs'; await writeFile(path, bundle.outputFiles[0].text); const m = await import('file://' + path), f = m.fixture;
        const params = () => ({ searchParams: Promise.resolve({ target: '2026', source }) });
        let html = renderToStaticMarkup(await m.Page(params())); assert.match(html, /rollover-editor-visible/);
        assert.ok(f.reads.filter((r: { table: string }) => r.table === 'current_merchant_rules').length >= 2);
        f.drift = true; f.stamps = 0; html = renderToStaticMarkup(await m.Page(params())); assert.match(html, /rollover-unavailable/); assert.ok(!html.includes('rollover-editor-visible'));
        f.signedIn = false; await assert.rejects(m.Page(params()), /REDIRECT:\/login/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
