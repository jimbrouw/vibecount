import {accountingTaxPackFixture} from './bank-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { packFixture, reviewFixture } from './filing-pack-fixture.ts';
import { buildFilingPack, buildFilingReview } from './filing-pack.ts';
import { canonicalJson, sha256 } from './snapshot.ts';
const root = fileURLToPath(new URL('../../', import.meta.url)), id = '11111111-1111-4111-8111-111111111111', request = '22222222-2222-4222-8222-222222222222';
function fixture() { const input = packFixture(), history = reviewFixture(input), bundle = buildFilingPack(input, history, request, true); return { input, history, model: buildFilingReview(input, history), row: { id, user_id: 'owner', calculation_id: input.calculation.id, tax_year_start: 2025, input, input_canonical_json: canonicalJson(input), input_sha256: bundle.input_sha256, bundle, bundle_canonical_json: canonicalJson(bundle), bundle_sha256: sha256(canonicalJson(bundle)), review_status: bundle.review_status, completeness_attested: true, request_id: request, reason: 'Synthetic review', author: 'owner', created_at: '2026-10-17' } }; }
test('all seven saved pack exports authenticate, audit owner scope and retain original bytes', async () => {
    const f = fixture();
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {GET} from './app/api/tax-prep/filing-pack/export/route.ts';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-pack-export', setup(b) { b.onResolve({ filter: /^(next\/server|@\/lib\/supabase\/server|test:db)$/ }, a => ({ path: a.path === 'next/server' ? a.path : 'test:db', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/server' ? "export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}" : `export const fixture={signedIn:true,reads:[],audit:[],row:${JSON.stringify(f.row)},failAudit:false};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){fixture.reads.push({table,filters});return Promise.resolve({data:fixture.row,error:null})},insert(data){fixture.audit.push(data);return Promise.resolve({error:fixture.failAudit?{}:null})}};return q}}}` })); } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')), state = m.fixture, url = 'http://localhost/api/tax-prep/filing-pack/export?id=' + id;
    state.signedIn = false;
    assert.equal((await m.GET(new Request(url))).status, 401);
    assert.equal(state.reads.length, 0);
    state.signedIn = true;
    assert.equal((await m.GET(new Request(url.replace(id, 'invalid')))).status, 400);
    for (const artifact of f.row.bundle.artifacts) {
        const response = await m.GET(new Request(url + '&artifact=' + artifact.name));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), artifact.body);
        assert.match(response.headers.get('cache-control')!, /no-store/);
        assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/);
        assert.equal(state.audit.at(-1).filing_pack_id, id);
    }
    const manifest = await (await m.GET(new Request(url))).json();
    assert.equal(manifest.request_id, request);
    assert.equal(manifest.reason, 'Synthetic review');
    assert.equal(manifest.artifacts.length, 7);
    assert.ok(state.reads.every((r: {
        filters: unknown[];
    }) => JSON.stringify(r.filters).includes('["user_id","owner"]')));
    assert.equal((await m.GET(new Request(url + '&artifact=../private'))).status, 404);
    const retained = JSON.parse(await readFile(new URL('../../fixtures/legacy-filing-pack-v1.json',import.meta.url),'utf8'));
    state.row = {...retained,id,user_id:'owner',calculation_id:retained.input.calculation.id};
    for(const artifact of retained.bundle.artifacts){const response=await m.GET(new Request(url+'&artifact='+artifact.name));assert.equal(response.status,200);assert.equal(await response.text(),artifact.body);}
    state.row=f.row;
    state.failAudit = true;
    assert.equal((await m.GET(new Request(url))).status, 500);
    state.failAudit = false;
    state.row.bundle_sha256 = '0'.repeat(64);
    const audits = state.audit.length;
    assert.equal((await m.GET(new Request(url))).status, 500);
    assert.equal(state.audit.length, audits);
    state.row = null;
    assert.equal((await m.GET(new Request(url))).status, 404);
});
test('pack action requires exact confirmation and server recomputation, and recovers saved requests before live reads', async () => {
    const f = fixture();
    f.input.calculation.id = id;
    const history = reviewFixture(f.input), model = buildFilingReview(f.input, history), output = buildFilingPack(f.input, history, request, true);
    const row = { ...f.row, calculation_id: id, input: f.input, input_canonical_json: canonicalJson(f.input), input_sha256: model.inputHash, bundle: output, bundle_canonical_json: canonicalJson(output), bundle_sha256: sha256(canonicalJson(output)) };
    const built = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {reviewFilingPack} from './app/dashboard/tax-prep/filing-pack/actions.ts';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-pack-action', setup(b) { b.onResolve({ filter: /^(next\/(navigation|cache)|@\/lib\/supabase\/(server|admin)|@\/lib\/tax\/filing-server|test:db)$/ }, a => ({ path: a.path.startsWith('next/') ? a.path : 'test:db', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? "export function revalidatePath(){}" : `export const fixture={signedIn:true,calls:[],reads:0,input:${JSON.stringify(f.input)},history:${JSON.stringify(history)},model:${JSON.stringify(model)},prior:null};export async function loadFilingContext(){fixture.reads++;return {input:fixture.input,history:fixture.history,model:fixture.model}}export function createAdminClient(){return {rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:'${id}',error:null}}}}export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},from(table){const q={select(){return q},eq(){return q},maybeSingle(){return Promise.resolve({data:fixture.prior,error:null})}};return q}}}` })); } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')), state = m.fixture;
    const form = () => { const body = new FormData(); for (const [key, value] of Object.entries({ year: 2025, calculation: id, requestId: request, inputHash: model.inputHash, action: 'capture', bundleHash: row.bundle_sha256, completenessAttested: 'yes', reason: 'Synthetic review', humanConfirmed: 'yes' }))
        body.set(key, String(value)); return body; };
    state.signedIn = false;
    await assert.rejects(m.reviewFilingPack(form()), /REDIRECT:\/login/);
    assert.equal(state.reads, 0);
    state.signedIn = true;
    const unconfirmed = form();
    unconfirmed.delete('humanConfirmed');
    await assert.rejects(m.reviewFilingPack(unconfirmed), /error=/);
    assert.equal(state.reads, 0);
    const forged = form();
    forged.set('bundleHash', '0'.repeat(64));
    await assert.rejects(m.reviewFilingPack(forged), /error=/);
    assert.equal(state.calls.length, 0);
    await assert.rejects(m.reviewFilingPack(form()), new RegExp('saved=' + id));
    assert.equal(state.calls[0].args.p_owner, 'owner');
    assert.equal(state.calls[0].args.p_bundle, row.bundle_canonical_json);
    state.prior = row;
    state.reads = 0;
    state.calls = [];
    state.input.calculation_is_current = false;
    await assert.rejects(m.reviewFilingPack(form()), new RegExp('saved=' + id));
    assert.equal(state.reads, 0);
    assert.equal(state.calls.length, 0);
    const changed = form();
    changed.set('reason', 'Changed request');
    await assert.rejects(m.reviewFilingPack(changed), /error=/);
    assert.equal(state.reads, 0);
});
test('filing context reads every capped history page and rejects source or review drift', async () => {
    const base=accountingTaxPackFixture(),input={...base,schema_version:'filing-pack-input/6' as const,documents:base.documents.map(d=>({...d,source_available:true}))},f={input,history:reviewFixture(input)}, rows = [...f.history.map((r, i) => ({ ...r, id: String(i).padStart(5, '0'), ordinal: i + 1 })), ...Array.from({ length: 501 }, (_, i) => ({ id: String(i + 10).padStart(5, '0'), ordinal: 100 + i, step: 'profile', digest: '0'.repeat(64), data: { trade_form: 'unknown', short_eligibility: 'unknown' }, reason: 'Stale synthetic review', author: 'owner', created_at: '2026-10-17' }))].sort((a, b) => a.id.localeCompare(b.id));
    const built = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {loadFilingContext} from './lib/tax/filing-server.ts';export {fixture,db} from 'test:db';" }, plugins: [{ name: 'inert-pack-context', setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' })); b.onResolve({ filter: /^test:db$/ }, () => ({ path: 'db', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'empty' ? 'export {};' : `export const fixture={input:${JSON.stringify(f.input)},rows:${JSON.stringify(rows)},pages:[],reads:0,stamps:0,sourceDrift:false,reviewDrift:false,failPage:false};export const db={async rpc(name){if(name==='read_tax_filing_pack_input'){fixture.reads++;const input=structuredClone(fixture.input);if(fixture.sourceDrift&&fixture.reads%2===0)input.documents.push({id:'new'});return {data:input,error:null}}fixture.stamps++;return {data:fixture.reviewDrift&&fixture.stamps%2===0?'changed':'stable',error:null}},from(){let after=null;const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},then(resolve,reject){fixture.pages.push({after,filters});const rows=fixture.rows.filter(r=>!after||r.id>after).slice(0,200);return Promise.resolve({data:rows,error:fixture.failPage?{}:null}).then(resolve,reject)}};return q}};` })); } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')), state = m.fixture;
    const context = await m.loadFilingContext(m.db, f.input.owner_id, 'calc');
    assert.equal(context.history.length, 511);
    assert.equal(context.model.current.length, 10);
    assert.equal(state.pages.length, 4);
    assert.ok(state.pages.every((p: {
        filters: unknown[];
    }) => JSON.stringify(p.filters).includes(JSON.stringify(['user_id',f.input.owner_id]))));
    state.reviewDrift = true;
    await assert.rejects(m.loadFilingContext(m.db, f.input.owner_id, 'calc'), /changed/);
    state.reviewDrift = false;
    state.sourceDrift = true;
    state.reads = 0;
    await assert.rejects(m.loadFilingContext(m.db, f.input.owner_id, 'calc'), /changed/);
    state.sourceDrift = false;
    state.failPage = true;
    await assert.rejects(m.loadFilingContext(m.db, f.input.owner_id, 'calc'));
    state.failPage=false;state.input.schema_version='filing-pack-input/3';await assert.rejects(m.loadFilingContext(m.db,f.input.owner_id,'calc'),/unavailable/);
});
