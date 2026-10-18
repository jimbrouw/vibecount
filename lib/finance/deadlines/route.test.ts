import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { londonPlanningDate, emptyFinancePlan } from '../defaults';
import { prepareFinancePlan } from '../snapshot';
import type { PlanRevision } from '../server';
import { emptyDeadlinePlan } from './model';
import { deadlineCatalogFromPlan, prepareDeadlineSnapshot } from './snapshot';
import { saveReviewedDeadlines, type DeadlineRevision } from './server';
const owner = '10000000-0000-4000-8000-000000000001', id = '20000000-0000-4000-8000-000000000002', request = '30000000-0000-4000-8000-000000000003', today = londonPlanningDate();
const documents = [1, 2, 3].map(n => ({ id: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: owner, file_sha256: String(n).repeat(64) }));
const catalog = deadlineCatalogFromPlan(owner, 2025, null, documents), plan = emptyDeadlinePlan(2025, catalog);
Object.assign(plan.entries.find(e => e.id === 'calendar:online')!, { applicability: 'applies', date_basis: 'notice', notice_due_date: '2027-02-01', notice_document_id: documents[0].id });
const p = prepareDeadlineSnapshot(owner, plan, today, catalog), reason = 'Synthetic reviewed reminders, no payment';
const row: DeadlineRevision = { id, user_id: owner, author: owner, tax_year_start: 2025, ordinal: 1, expected_ordinal: 0, source_plan_id: null, context_stamp: 'a'.repeat(32), request_id: request, rationale: reason, created_at: today,
    input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
const review = { year: 2025, expected: 0, stamp: row.context_stamp, request, reason, plan, resultJson: p.resultJson, rulesHash: p.rulesHash };
test('deadline save recovers exact historical requests before live reads and rejects changed intent', async () => {
    let reads = 0, captures = 0;
    const io = { recover: async () => row as DeadlineRevision | null, historical: async () => catalog, read: async () => { reads++; return { context: { owner_id: owner, tax_year_start: 2025, ordinal: 0, stamp: row.context_stamp, source_plan_id: null }, catalog }; }, capture: async () => { captures++; return id; } };
    assert.equal(await saveReviewedDeadlines(owner, review, '2099-01-01', io), id); assert.equal(reads, 0);
    await assert.rejects(saveReviewedDeadlines(owner, { ...review, reason: 'Changed' }, today, io), /different inputs/);
    await assert.rejects(saveReviewedDeadlines(owner, { ...review, year: 2026 }, today, io), /different inputs/);
    assert.equal(await saveReviewedDeadlines(owner, review, today, { ...io, recover: async () => null }), id); assert.equal(captures, 1);
    await assert.rejects(saveReviewedDeadlines(owner, { ...review, resultJson: JSON.stringify({ ...p.result, active_count: 999 }) }, today, { ...io, recover: async () => null }), /read-back changed/);
    await assert.rejects(saveReviewedDeadlines(owner, review, '2099-01-01', { ...io, recover: async () => null }), /read-back changed/);
});
async function fixture() {
    const root = fileURLToPath(new URL('../../../', import.meta.url)), directory = await mkdtemp(join(root, '.deadline-route-test-'));
    try {
        const b = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom/server'], stdin: { resolveDir: root, contents: `import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/finance/deadlines/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {reviewTaxDeadlines} from './app/dashboard/finance/deadlines/actions.ts';export {GET} from './app/api/finance/deadlines/export/route.ts';export {fixture,createClient} from 'test:db';` }, plugins: [{ name: 'inert-deadline-boundaries', setup(b) {
            b.onResolve({ filter: /^(next\/(navigation|cache|server|link)|@\/lib\/supabase\/(server|admin)|test:db|\.\/DeadlineReview)$/ }, a => ({ path: a.path.startsWith('next/') || a.path === './DeadlineReview' ? a.path : 'test:db', namespace: 'fixture' }));
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : a.path === 'next/server' ? 'export class NextResponse extends Response{static json(v,i){return new Response(JSON.stringify(v),i)}}' : a.path === 'next/link' ? "import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}" : a.path === './DeadlineReview' ? "import React from 'react';export default function Review({initial}){return React.createElement('div',{'data-testid':'inert-deadline-editor'},JSON.stringify(initial))}" : `
export const fixture={nonce:${JSON.stringify(randomUUID())},signedIn:true,prior:null,row:${JSON.stringify(row)},latest:null,history:[],finance:null,finances:[],documents:${JSON.stringify(documents)},calls:[],reads:[],audit:[],contextCalls:0,drift:false,failRead:false,failAudit:false,missing:false};
export function createAdminClient(){return {rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:'${id}',error:null}}}}
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${owner}'}:null},error:null})},rpc:async(name,args)=>{fixture.contextCalls++;return {data:{owner_id:'${owner}',tax_year_start:args.p_year,ordinal:fixture.latest?.ordinal??0,source_plan_id:fixture.finance?.id??null,stamp:(fixture.drift&&fixture.contextCalls>1?'b':'a').repeat(32)},error:null}},from(table){let filters=[],cursor=null,before=null;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},in(k,v){filters.push([k,v]);return q},gt(k,v){cursor=v;return q},lt(k,v){before=v;return q},maybeSingle(){fixture.reads.push({table,filters});const data=table==='finance_plan_revisions'?(filters.some(v=>v[0]==='id')?fixture.finances.find(r=>r.id===filters.find(v=>v[0]==='id')[1])??null:fixture.finance):filters.some(v=>v[0]==='request_id')?fixture.prior:filters.some(v=>v[0]==='id')?(fixture.missing?null:fixture.row):fixture.latest;return Promise.resolve({data,error:fixture.failRead?{}:null})},insert(data){fixture.audit.push(data);return Promise.resolve({error:fixture.failAudit?{}:null})},then(resolve){fixture.reads.push({table,filters,cursor,before});let rows=['evidence_documents','current_evidence_documents'].includes(table)?fixture.documents:fixture.history;for(const [k,v]of filters)rows=rows.filter(r=>Array.isArray(v)?v.includes(r[k]):r[k]===v);rows=rows.filter(r=>!cursor||r.id>cursor).filter(r=>!before||r.ordinal<before).slice(0,2);return Promise.resolve({data:rows,error:fixture.failRead?{}:null}).then(resolve)}};return q}}}` }));
        } }] });
        const path = join(directory, 'fixture.mjs'); await writeFile(path, b.outputFiles[0].text); return await import(pathToFileURL(path).href);
    } finally { await rm(directory, { recursive: true, force: true }); }
}
function form() { const f = new FormData(); for (const [k, v] of Object.entries({ year: 2025, expected: 0, stamp: review.stamp, requestId: request, rulesHash: p.rulesHash, reason, plan: JSON.stringify(plan), preview: p.resultJson, humanConfirmed: 'yes' })) f.set(k, String(v)); return f; }
test('deadline action requires auth and exact confirmation/read-back before owner-derived capture', async () => {
    const m = await fixture(), f = m.fixture;
    f.signedIn = false; await assert.rejects(m.reviewTaxDeadlines(form()), /REDIRECT:\/login/); assert.equal(f.calls.length, 0);
    f.signedIn = true; const unconfirmed = form(); unconfirmed.delete('humanConfirmed'); await assert.rejects(m.reviewTaxDeadlines(unconfirmed), /error=/);
    const forged = form(); forged.set('preview', JSON.stringify({ ...p.result, active_count: 100 })); await assert.rejects(m.reviewTaxDeadlines(forged), /error=/); assert.equal(f.calls.length, 0);
    await assert.rejects(m.reviewTaxDeadlines(form()), new RegExp('saved=' + id)); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'capture_tax_deadline_review'); assert.equal(f.calls[0].args.p_owner, owner); assert.equal(f.calls[0].args.p_input, p.inputJson);
    f.prior = row; f.drift = true; f.calls = []; const old = f.contextCalls;
    await assert.rejects(m.reviewTaxDeadlines(form()), new RegExp('saved=' + id)); assert.equal(f.contextCalls, old); assert.equal(f.calls.length, 0);
});
test('deadline historical export authenticates, verifies sources/provenance and audits before releasing exact bytes', async () => {
    const m = await fixture(), f = m.fixture, url = 'http://localhost/api/finance/deadlines/export?id=' + id;
    f.signedIn = false; assert.equal((await m.GET(new Request(url))).status, 401); assert.equal(f.reads.length, 0);
    f.signedIn = true; assert.equal((await m.GET(new Request('http://localhost?id=bad'))).status, 400);
    const response = await m.GET(new Request(url)); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
    const body = await response.json(); assert.deepEqual(body.result, p.result); assert.deepEqual(body.input, p.input); assert.equal(f.audit[0].tax_deadline_id, id);
    assert.ok(f.reads.every((r: { filters: unknown[] }) => JSON.stringify(r.filters).includes(owner)));
    f.failAudit = true; assert.equal((await m.GET(new Request(url))).status, 500); f.failAudit = false;
    f.documents[0].file_sha256 = 'f'.repeat(64); const audits = f.audit.length; assert.equal((await m.GET(new Request(url))).status, 500); assert.equal(f.audit.length, audits);
    f.documents = documents; f.row.author = 'foreign'; assert.equal((await m.GET(new Request(url))).status, 500); assert.equal(f.audit.length, audits);
    f.missing = true; assert.equal((await m.GET(new Request(url))).status, 404);
});
test('deadline page reads complete capped sources, separates history/currentness and suppresses drift', async () => {
    const m = await fixture(), f = m.fixture;
    let html = await m.render({ year: '2025' }); assert.match(html, /inert-deadline-editor/); assert.match(html, /No saved reminder review/);
    assert.ok(f.reads.filter((r: { table: string }) => r.table === 'current_evidence_documents').length >= 3);
    f.latest = row; f.history = [{ id, user_id: owner, tax_year_start: 2025, ordinal: 1, created_at: today, rationale: reason }];
    html = await m.render({ year: '2025', saved: id }); assert.match(html, /Historical review revision/); assert.match(html, /Current in-app reminders/); assert.match(html, /deadline-export/);
    f.contextCalls = 0; f.drift = true; html = await m.render({ year: '2025' }); assert.match(html, /deadline-unavailable/); assert.doesNotMatch(html, /inert-deadline-editor/);
    f.drift = false; f.failRead = true; html = await m.render({ year: '2025' }); assert.match(html, /deadline-unavailable/);
    f.signedIn = false; await assert.rejects(m.render({}), /REDIRECT:\/login/);
});

function sourceFinance(ordinal: number, amount: number): PlanRevision {
    const plan = emptyFinancePlan(today); plan.obligations.push({ id: 'demand', label: 'Synthetic reviewed remaining amount', kind: 'tax', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: amount });
    const f = prepareFinancePlan(owner, plan, today, { accounts: [], documents: [] });
    return { id: `50000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`, user_id: owner, author: owner, ordinal, expected_ordinal: ordinal - 1, request_id: request, context_stamp: 'a'.repeat(32), rationale: reason, created_at: today,
        input: f.input, result: f.result, input_canonical_json: f.inputJson, result_canonical_json: f.resultJson, rules_canonical_json: f.rulesJson, input_sha256: f.inputHash, result_sha256: f.resultHash, rules_sha256: f.rulesHash };
}
test('deadline history uses its retained cash source while a new current source withholds reminders and resets proposals', async () => {
    const m = await fixture(), f = m.fixture, old = sourceFinance(1, 12300), current = sourceFinance(2, 40000);
    const c = deadlineCatalogFromPlan(owner, 2025, old, documents), plan = emptyDeadlinePlan(2025, c);
    Object.assign(plan.entries.find(e => e.id === 'commitment:demand')!, { applicability: 'applies', date_basis: 'saved_obligation' });
    const p = prepareDeadlineSnapshot(owner, plan, today, c);
    f.finance = current; f.finances = [old, current]; f.row = { ...row, source_plan_id: old.id, input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
    f.latest = f.row;
    const response = await m.GET(new Request('http://localhost/api/finance/deadlines/export?id=' + id));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.input.sources.finance_plan.id, old.id); assert.equal(body.input.sources.obligations[0].amount_pence, 12300);
    const html = await m.render({ year: '2025' }); assert.match(html, /deadline-source-stale/); assert.match(html, /inert-deadline-editor/); assert.match(html, /Changed sources reset proposals to unresolved/);
    assert.doesNotMatch(html, /&quot;applicability&quot;:&quot;applies&quot;/); // New editor never carries the old approval.
});
