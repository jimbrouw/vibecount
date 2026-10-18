import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepareFinancePlan, prepareBankCoveredFinancePlan } from './snapshot.ts';
import { readFinanceReview, saveReviewedFinancePlan, type PlanRevision } from './server.ts';
import { financeFixture } from './test-fixture.ts';
import { bankSourceCoverageFixture } from '../records/bank-source-coverage-fixture';
import { syntheticCoverage } from '../invoices/currency-coverage-fixture';
import { emptyFinancePlan, londonPlanningDate } from './defaults.ts';
const id = '11111111-1111-4111-8111-111111111111', request = '22222222-2222-4222-8222-222222222222', today = londonPlanningDate();
const bank = bankSourceCoverageFixture(), coverage = syntheticCoverage(bank.owner_id), plan = financeFixture(today), p = prepareBankCoveredFinancePlan('00000000-0000-4000-8000-000000000001', plan, today, { accounts: [], documents: [] }, coverage, bank);
const row: PlanRevision = { id, user_id: '00000000-0000-4000-8000-000000000001', ordinal: 1, expected_ordinal: 0, context_stamp: 'a'.repeat(32), request_id: request, rationale: 'Synthetic review', author: '00000000-0000-4000-8000-000000000001', created_at: today,
    input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
const legacy = prepareFinancePlan('00000000-0000-4000-8000-000000000001', plan, today, { accounts: [], documents: [] });
const legacyRow: PlanRevision = { ...row, input: legacy.input, result: legacy.result, input_canonical_json: legacy.inputJson, result_canonical_json: legacy.resultJson, input_sha256: legacy.inputHash, result_sha256: legacy.resultHash };
const review = { request, reason: row.rationale, expected: 0, stamp: row.context_stamp, plan, resultJson: JSON.stringify(p.result), rulesHash: p.rulesHash };

test('cash review helper recovers exact historical requests before live reads and rejects changed read-back', async () => {
    let reads = 0, captures = 0;
    const io = { recover: async () => row as PlanRevision | null, read: async () => { reads++; return { context: { schema_version: 'finance-plan-context/3' as const, owner_id: '00000000-0000-4000-8000-000000000001', ordinal: 0, stamp: row.context_stamp, invoice_coverage: coverage, bank_source_coverage: bank }, catalog: { accounts: [], documents: [] } }; }, capture: async () => { captures++; return id; } };
    assert.equal(await saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', review, '2099-01-01', io), id); assert.equal(reads, 0);
    await assert.rejects(saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', { ...review, reason: 'Changed' }, today, io), /different/);
    await assert.rejects(saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', { ...review, resultJson: JSON.stringify({ ...p.result, scenario: { ...p.result.scenario, actual_cash_pence: 99999999 } }) }, today, { ...io, recover: async () => null }), /read-back changed/);
    assert.equal(captures, 0);
    assert.equal(await saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', review, today, { ...io, recover: async () => null }), id); assert.equal(captures, 1);
    await assert.rejects(saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', { ...review, expected: 1 }, today, { ...io, recover: async () => null }), /inputs changed/);
    await assert.rejects(saveReviewedFinancePlan('00000000-0000-4000-8000-000000000001', review, '2099-01-01', { ...io, recover: async () => null }), /read-back changed/);
});
async function moduleFixture() {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {reviewFinancePlan} from './app/dashboard/finance/actions.ts';export {GET} from './app/api/finance/export/route.ts';export {fixture,createClient} from 'test:db';" }, plugins: [{ name: 'inert-finance-boundaries', setup(b) {
        b.onResolve({ filter: /^(next\/(navigation|cache|server)|@\/lib\/supabase\/(server|admin)|test:db)$/ }, a => ({ path: a.path.startsWith('next/') ? a.path : 'test:db', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : a.path === 'next/server' ? 'export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}' : `
export const fixture={nonce:${JSON.stringify(randomUUID())},signedIn:true,prior:null,row:${JSON.stringify(row)},calls:[],audit:[],reads:[],accounts:[],documents:[],coverage:${JSON.stringify(coverage)},bank:${JSON.stringify(bank)},contextCalls:0,drift:false,coverageDrift:false,bankDrift:false,oldVersion:false,bankMissing:false,failAudit:false,failRead:false};
export function createAdminClient(){return {rpc:async(name,args)=>{fixture.calls.push({name,args,privileged:true});return {data:'${id}',error:null}}}}
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'00000000-0000-4000-8000-000000000001'}:null},error:null})},rpc:async(name)=>{fixture.contextCalls++;return {data:{schema_version:fixture.oldVersion?'finance-plan-context/2':'finance-plan-context/3',owner_id:'00000000-0000-4000-8000-000000000001',ordinal:0,bank_source_coverage:fixture.bankMissing?null:fixture.bankDrift&&fixture.contextCalls>1?{...fixture.bank,stamp:'f'.repeat(64)}:fixture.bank,invoice_coverage:fixture.coverageDrift&&fixture.contextCalls>1?{...fixture.coverage,draft_invoice_count:1}:fixture.coverage,stamp:(fixture.drift&&fixture.contextCalls>1?'b':'a').repeat(32)},error:null}},from(table){let filters=[],cursor=null;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},in(){return q},gt(k,v){cursor=v;return q},maybeSingle(){fixture.reads.push({table,filters});return Promise.resolve({data:filters.some(v=>v[0]==='request_id')?fixture.prior:fixture.row,error:null})},insert(data){fixture.audit.push(data);return Promise.resolve({error:fixture.failAudit?{}:null})},then(resolve){fixture.reads.push({table,filters,cursor});const values=(table==='financial_accounts'?fixture.accounts:fixture.documents).filter(v=>!cursor||v.id>cursor).slice(0,2);return Promise.resolve({data:values,error:fixture.failRead?{}:null}).then(resolve)}};return q}}}` }));
    } }] });
    return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
function form() {
    const f = new FormData(); for (const [key, value] of Object.entries({ requestId: request, reason: review.reason, expected: 0, stamp: review.stamp, plan: JSON.stringify(plan), preview: review.resultJson, rulesHash: p.rulesHash, humanConfirmed: 'yes' })) f.set(key, String(value)); return f;
}
test('cash-plan action requires auth/confirmation, recomputes the read-back and captures only authenticated owner', async () => {
    const m = await moduleFixture(), f = m.fixture;
    f.signedIn = false; await assert.rejects(m.reviewFinancePlan(form()), /REDIRECT:\/login/); assert.equal(f.calls.length, 0);
    f.signedIn = true; const unconfirmed = form(); unconfirmed.delete('humanConfirmed'); await assert.rejects(m.reviewFinancePlan(unconfirmed), /error=/); assert.equal(f.calls.length, 0);
    const forged = form(); forged.set('preview', JSON.stringify({ ...p.result, scenario: { ...p.result.scenario, actual_cash_pence: 99999999 } }));
    await assert.rejects(m.reviewFinancePlan(forged), /error=/); assert.equal(f.calls.length, 0);
    await assert.rejects(m.reviewFinancePlan(form()), new RegExp('saved=' + id));
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.p_owner, '00000000-0000-4000-8000-000000000001'); assert.equal(f.calls[0].args.p_input, p.inputJson); assert.equal(f.calls[0].args.p_result, p.resultJson);
    f.prior = row; f.drift = true; f.calls = []; const reads = f.contextCalls;
    await assert.rejects(m.reviewFinancePlan(form()), new RegExp('saved=' + id)); assert.equal(f.contextCalls, reads); assert.equal(f.calls.length, 0);
    f.prior = legacyRow;const retained = form();retained.set('preview', legacy.resultJson);await assert.rejects(m.reviewFinancePlan(retained), new RegExp('saved=' + id));assert.equal(f.contextCalls,reads);assert.equal(f.calls.length,0);
});
test('cash-plan export authenticates, checks provenance/hashes and records owner-linked audit before release', async () => {
    const m = await moduleFixture(), f = m.fixture, url = 'http://localhost/api/finance/export?id=' + id;
    f.signedIn = false; assert.equal((await m.GET(new Request(url))).status, 401); assert.equal(f.reads.length, 0);
    f.signedIn = true; assert.equal((await m.GET(new Request('http://localhost/api/finance/export?id=bad'))).status, 400);
    const response = await m.GET(new Request(url)); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
    const body = await response.json(); assert.deepEqual(body.result, p.result); assert.deepEqual(body.input, p.input); assert.equal(f.audit[0].finance_plan_id, id);
    assert.ok(f.reads.every((r: { filters: unknown[] }) => JSON.stringify(r.filters).includes('["user_id","00000000-0000-4000-8000-000000000001"]')));
    f.row=legacyRow;const retained=await (await m.GET(new Request(url))).json();assert.deepEqual(retained.input,legacy.input);assert.deepEqual(retained.result,legacy.result);f.row=row;
    f.failAudit = true; assert.equal((await m.GET(new Request(url))).status, 500); f.failAudit = false;
    f.row.user_id = 'foreign'; const audits = f.audit.length;
    assert.equal((await m.GET(new Request(url))).status, 500); assert.equal(f.audit.length, audits);
    f.row.user_id = '00000000-0000-4000-8000-000000000001'; f.row.result_sha256 = '0'.repeat(64);
    assert.equal((await m.GET(new Request(url))).status, 500); assert.equal(f.audit.length, audits);
});
test('cash source reader reaches empty capped pages and rejects catalog drift or incomplete reads', async () => {
    const m = await moduleFixture(), f = m.fixture;
    f.accounts = Array.from({ length: 5 }, (_, n) => ({ id: 'account-' + n, user_id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic bank', provider: 'generic', account_type: 'bank', currency: 'GBP', masked_identifier: '1234' }));
    f.documents = Array.from({ length: 3 }, (_, n) => ({ id: 'document-' + n, user_id: '00000000-0000-4000-8000-000000000001', file_sha256: 'a'.repeat(64), media_type: 'application/pdf', size_bytes: 100 }));
    const result = await readFinanceReview(await m.createClient(), '00000000-0000-4000-8000-000000000001');
    assert.equal(result.catalog.accounts.length, 5); assert.equal(result.catalog.documents.length, 3);
    assert.ok(f.reads.filter((r: { table: string }) => r.table === 'financial_accounts').length >= 4);
    f.contextCalls = 0; f.drift = true; await assert.rejects(readFinanceReview(await m.createClient(), '00000000-0000-4000-8000-000000000001'), /changed/);
    f.drift=false;f.contextCalls=0;f.coverageDrift=true;await assert.rejects(readFinanceReview(await m.createClient(),'00000000-0000-4000-8000-000000000001'),/changed/);f.coverageDrift=false;
    f.contextCalls=0;f.bankDrift=true;await assert.rejects(readFinanceReview(await m.createClient(),'00000000-0000-4000-8000-000000000001'),/changed/);f.bankDrift=false;f.oldVersion=true;await assert.rejects(readFinanceReview(await m.createClient(),'00000000-0000-4000-8000-000000000001'),/context/);f.oldVersion=false;f.bankMissing=true;await assert.rejects(readFinanceReview(await m.createClient(),'00000000-0000-4000-8000-000000000001'),/coverage/);f.bankMissing=false;
    f.drift = false; f.failRead = true; await assert.rejects(readFinanceReview(await m.createClient(), '00000000-0000-4000-8000-000000000001'), /complete export/);
    f.failRead=false;f.coverage={};await assert.rejects(readFinanceReview(await m.createClient(),'00000000-0000-4000-8000-000000000001'),/coverage/);
});
test('production defaults are unknown and London evaluation date follows the local day at UTC midnight boundaries', () => {
    const empty = emptyFinancePlan('2026-10-17'); assert.deepEqual(empty.assets, []); assert.deepEqual(empty.earmarks, []);
    assert.equal(empty.forecast.annual_turnover_pence, null); assert.equal(empty.cash_complete, false);
    assert.equal(londonPlanningDate(new Date('2026-06-30T23:30:00Z')), '2026-07-01');
    assert.equal(londonPlanningDate(new Date('2026-12-31T23:30:00Z')), '2026-12-31');
});
