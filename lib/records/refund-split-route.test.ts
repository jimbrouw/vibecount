import { nativeSourceContextFixture, connectedReviewFixture } from './native-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitRefundFixture } from './refund-split-fixture';
import { sourceDependenciesFixture } from '../fx/dependency-fixture';
import { validateRefundSplitIntent } from './refund-splits';

async function fixture() {
    const root = fileURLToPath(new URL('../../', import.meta.url)), directory = await mkdtemp(join(root, '.refund-split-route-test-')), f = splitRefundFixture();
    try {
        const b = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom/server', 'react-dom'], stdin: { resolveDir: root, contents: `import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/reconciliation/refunds/split/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {approveRefundSplit} from './app/dashboard/reconciliation/refunds/split/actions.ts';export {fixture} from 'test:db';` }, plugins: [{ name: 'inert-split-boundaries', setup(b) {
            b.onResolve({ filter: /^(next\/(navigation|cache|link)|@\/lib\/supabase\/server|test:db)$/ }, a => ({ path: a.path.startsWith('next/') ? a.path : 'test:db', namespace: 'fixture' }));
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : a.path === 'next/link' ? "import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}" : `
const sourceDependenciesFixture = ${sourceDependenciesFixture.toString()};
const nativeSourceContextFixture=${nativeSourceContextFixture.toString()};
const connectedReviewFixture=${connectedReviewFixture.toString()};
function currentEnvelope(...args){const data=connectedReviewFixture(...args,fixture.extraRows);data.source_context.source_stamp=fixture.sourceStamp;return data}
export const fixture={blockedIds:[],sourceStamp:'a'.repeat(64),extraRows:[],signedIn:true,catalog:${JSON.stringify(f.catalog)},calls:[],history:[],prior:false,historyFail:false,readFail:false,writeFail:false};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${f.owner}'}:null},error:null})},from(name){const q={select(){return q},eq(k,v){fixture.history.push([name,k,v]);return q},async maybeSingle(){return {data:fixture.prior?{request_id:'retained'}:null,error:fixture.historyFail?{message:'PRIVATE'}:null}}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:name==='read_refund_split_catalog_v3'?(fixture.catalog?currentEnvelope('split',fixture.catalog,{id:args.p_refund},fixture.blockedIds):null):{schema_version:'refund-split-result/1'},error:(name==='read_refund_split_catalog_v3'?fixture.readFail:fixture.writeFail)?{message:'PRIVATE_DATABASE_DETAIL'}:null}}}}` }));
        } }] });
        const path = join(directory, 'fixture.mjs'); await writeFile(path, b.outputFiles[0].text); return await import(pathToFileURL(path).href);
    } finally { await rm(directory, { recursive: true, force: true }); }
}
function form(intent: unknown = splitRefundFixture().intent) { const f = new FormData(); f.set('intent', JSON.stringify(intent)); f.set('humanConfirmed', 'yes'); f.set('sourceStamp','a'.repeat(64)); return f; }
test('split action authenticates and requires exact human intent before any source or write call', async () => {
    const m = await fixture(), f = m.fixture; f.signedIn = false; await assert.rejects(m.approveRefundSplit(form()), /REDIRECT:\/login/); assert.equal(f.calls.length, 0); f.signedIn = true;
    for (const patch of [null, {}, { ...splitRefundFixture().intent, owner: 'foreign' }, { ...splitRefundFixture().intent, refund_version: '0' }]) await assert.rejects(m.approveRefundSplit(form(patch)), /error=Review/);
    for (const action of [(f: FormData) => f.delete('humanConfirmed'), (f: FormData) => f.append('intent', '{}'), (f: FormData) => f.append('humanConfirmed', 'yes'), (f: FormData) => f.set('intent', 'x'.repeat(64001))]) { const bad = form(); action(bad); await assert.rejects(m.approveRefundSplit(bad), /error=Review/); }
    assert.equal(f.calls.length, 0); assert.equal(f.history.length, 0);
    const good = form(); good.set('owner', 'foreign'); good.set('result', 'untrusted'); await assert.rejects(m.approveRefundSplit(good), /result=approved/);
    assert.deepEqual(f.calls.map((c: { name: string }) => c.name), ['read_refund_split_catalog_v3', 'approve_refund_split']);
    assert.deepEqual(f.calls[1].args, { p_intent: validateRefundSplitIntent(splitRefundFixture().intent) });
    assert.ok(f.history.some((entry: string[]) => entry[1] === 'user_id' && entry[2] === splitRefundFixture().owner));
});
test('split action recomputes new reviews, withholds failed history/catalog and relies on final SQL freshness', async () => {
    const m = await fixture(), f = m.fixture;
    f.historyFail = true; await assert.rejects(m.approveRefundSplit(form()), /history%20unavailable/); assert.equal(f.calls.length, 0); f.historyFail = false;
    f.readFail = true; await assert.rejects(m.approveRefundSplit(form()), /sources%20or%20portions%20changed/); assert.equal(f.calls.length, 1); f.readFail = false;
    f.catalog.stamp = '0'.repeat(32); await assert.rejects(m.approveRefundSplit(form()), /sources%20or%20portions%20changed/); assert.equal(f.calls.filter((c: { name: string }) => c.name === 'approve_refund_split').length, 0);
    f.catalog = splitRefundFixture().catalog; f.writeFail = true;
    await assert.rejects(m.approveRefundSplit(form()), e => { assert.match((e as Error).message, /approval%20unavailable/); assert.ok(!(e as Error).message.includes('PRIVATE')); return true; });
    assert.equal(f.calls.at(-1).name, 'approve_refund_split');
});
test('completed split retries retain old intent, skip live catalog and still require database fingerprint verification', async () => {
    const m = await fixture(), f = m.fixture, original = splitRefundFixture().intent; f.prior = true; f.readFail = true; f.catalog = null;
    const reordered = { ...original, allocations: [...original.allocations].reverse() };
    await assert.rejects(m.approveRefundSplit(form(reordered)), /result=approved/);
    assert.deepEqual(f.calls, [{ name: 'approve_refund_split', args: { p_intent: validateRefundSplitIntent(original) } }]);
    // Model the authoritative database rejecting changed/cross-method payloads.
    f.writeFail = true; await assert.rejects(m.approveRefundSplit(form({ ...original, rationale: 'Changed retained request' })), /approval%20unavailable/);
    assert.equal(f.calls.at(-1).name, 'approve_refund_split'); assert.equal(f.calls.at(-1).args.p_intent.expected_stamp, original.expected_stamp);
});
test('split page withholds invalid, foreign, failed and incomplete catalogs and exposes a draft gate only', async () => {
    const m = await fixture(), f = m.fixture, source = splitRefundFixture(); f.signedIn = false; await assert.rejects(m.render({ refund: source.refund.id }), /REDIRECT:\/login/); assert.equal(f.calls.length, 0); f.signedIn = true;
    assert.match(await m.render({ refund: 'bad' }), /refund-split-unavailable/); assert.equal(f.calls.length, 0);
    const html = await m.render({ refund: source.refund.id }); assert.match(html, /refund-split-review/); assert.match(html, /five hundred pounds/); assert.match(html, /Draft refund allocation/); assert.match(html, /disabled/);
    f.catalog.owner_id = '00000000-0000-4000-8000-000000000999'; assert.match(await m.render({ refund: source.refund.id }), /refund-split-unavailable/);
    f.catalog = source.catalog; f.readFail = true; assert.match(await m.render({ refund: source.refund.id }), /refund-split-unavailable/); f.readFail = false;
    f.catalog.transactions = []; assert.match(await m.render({ refund: source.refund.id }), /refund-split-unavailable/);
});

test('current split review disables blocked originals and withholds refund confirmation for zero-cash FX', async () => {
 const m = await fixture(), f = m.fixture, source = splitRefundFixture();
 f.blockedIds = [source.original.id];
 const html = await m.render({refund:source.refund.id});
 assert.match(html, /Unavailable — linked FX/); assert.match(html, /refund-split-originals-fx-blocked/);
 await assert.rejects(m.approveRefundSplit(form()), /sources%20or%20portions%20changed/);
 assert.equal(f.calls.filter((c: {name:string})=>c.name==='approve_refund_split').length,0);
 f.blockedIds = [source.refund.id]; const blocked = await m.render({refund:source.refund.id});
 assert.match(blocked, /refund-split-fx-blocked/); assert.doesNotMatch(blocked, /data-testid="refund-split-review"/); assert.match(blocked,/separate human financial confirmation/);
 f.prior=true;f.readFail=true;await assert.rejects(m.approveRefundSplit(form()),/result=approved/);assert.equal(f.calls.at(-1).name,'approve_refund_split');
});

test('current split source digest rejects missing, duplicate and stale confirmation while retained requests recover',async()=>{
 const m=await fixture(),f=m.fixture;
 for(const mode of ['missing','duplicate','stale']){const body=form();if(mode==='missing')body.delete('sourceStamp');if(mode==='duplicate')body.append('sourceStamp','a'.repeat(64));if(mode==='stale')f.sourceStamp='b'.repeat(64);await assert.rejects(m.approveRefundSplit(body),/sources%20or%20portions%20changed/)}
 assert.equal(f.calls.filter((c:{name:string})=>c.name==='approve_refund_split').length,0);
 f.prior=true;const old=form();old.delete('sourceStamp');await assert.rejects(m.approveRefundSplit(old),/result=approved/);
});
test('split page retains unsupported originals outside the native form and withholds unsupported selected cash',async()=>{
 const m=await fixture(),f=m.fixture,native=splitRefundFixture(),foreign={...native.original,id:'00000000-0000-4000-8000-000000000888',source_row_id:'00000000-0000-4000-8000-000000000889',currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'};
 f.extraRows=[foreign];const html=await m.render({refund:native.refund.id});assert.match(html,/KWD 10.001/);assert.match(html,/refund-split-native-blocked/);assert.match(html,/data-testid="refund-split-review"/);assert.doesNotMatch(html,/<option[^>]*value="00000000-0000-4000-8000-000000000888"/);
 f.catalog={...native.catalog,transactions:[foreign]};f.extraRows=[];const blocked=await m.render({refund:foreign.id});assert.match(blocked,/KWD 10.001/);assert.doesNotMatch(blocked,/data-testid="refund-split-review"/);
});
