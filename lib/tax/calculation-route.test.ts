import {accountingTaxPackFixture,foreignTaxBankFixture} from './bank-source-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { prepareCalculation, canonicalJson, sha256, type SavedCalculation } from './snapshot.ts';
import { saveReviewedCalculation } from './capture-review.ts';
import { rules2025 } from './rules.ts';
import type { CalculationInput } from './calculation.ts';
import {renderToStaticMarkup} from 'react-dom/server';
const input: CalculationInput = { schema_version: 'tax-calculation-input/1', owner_id: 'owner', tax_year_start: 2025, financial_stamp: 'a'.repeat(32), profile: null, scope: null, sections: [], facts: [], sources: [], records: [], observations: [] };
const prepared = prepareCalculation(input), id = '11111111-1111-4111-8111-111111111111', request = '22222222-2222-4222-8222-222222222222';
const saved: SavedCalculation = { id, tax_year_start: 2025, ruleset_id: rules2025.id, engine_version: rules2025.engine_version, input, result: prepared.result, input_canonical_json: prepared.inputJson, result_canonical_json: prepared.resultJson, input_sha256: prepared.inputHash, result_sha256: prepared.resultHash, rationale: 'Synthetic review', author: 'owner', request_id: request, created_at: '2026-10-17' };
const rules = { id: rules2025.id, canonical_json: prepared.rulesJson, sha256: prepared.rulesHash };
test('reviewed snapshot save recovers exact history before live reads and rejects changed review digests', async () => {
    const review = { year: 2025, request, reason: 'Synthetic review', inputHash: prepared.inputHash, resultHash: prepared.resultHash, rulesHash: prepared.rulesHash };
    let reads = 0, captures = 0;
    const io = { recover: async () => ({ row: saved, rules }), read: async () => { reads++; return { ...input, financial_stamp: 'changed' }; }, capture: async () => { captures++; return id; } };
    assert.equal(await saveReviewedCalculation(review, io), id);
    assert.equal(reads, 0);
    assert.equal(captures, 0);
    await assert.rejects(saveReviewedCalculation({ ...review, reason: 'Different' }, io), /different inputs/);
    await assert.rejects(saveReviewedCalculation(review, { ...io, recover: async () => null }), /changed/);
    assert.equal(captures, 0);
    assert.equal(await saveReviewedCalculation(review, { ...io, recover: async () => null, read: async () => input }), id);
    assert.equal(captures, 1);
    assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
    assert.throws(() => canonicalJson({ amount: 0.1 }), /exact/);
    assert.throws(() => canonicalJson({ amount: undefined }), /Unsupported/);
});
test('saved calculation export authenticates and audits the immutable historical snapshot', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {GET} from './app/api/tax-prep/calculation/export/route.ts';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-calculation-export', setup(b) {
                    b.onResolve({ filter: /^(next\/server|@\/lib\/supabase\/server|test:db)$/ }, a => ({ path: a.path === 'next/server' ? a.path : 'test:db', namespace: 'fixture' }));
                    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/server' ? "export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}" : `export const fixture={signedIn:true,reads:[],audit:[],row:${JSON.stringify(saved)},rules:${JSON.stringify(rules)},failAudit:false};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},from(table){let filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){fixture.reads.push({table,filters});return Promise.resolve({data:fixture.row,error:null})},single(){return Promise.resolve({data:fixture.rules,error:null})},insert(data){fixture.audit.push(data);return Promise.resolve({error:fixture.failAudit?{}:null})}};return q}}}` }));
                } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')), f = m.fixture, url = 'http://localhost/api/tax-prep/calculation/export?id=' + id;
    f.signedIn = false;
    assert.equal((await m.GET(new Request(url))).status, 401);
    assert.equal(f.reads.length, 0);
    f.signedIn = true;
    assert.equal((await m.GET(new Request('http://localhost/api/tax-prep/calculation/export?id=invalid'))).status, 400);
    const response = await m.GET(new Request(url));
    assert.equal(response.status, 200);
    const exported = await response.json();
    assert.deepEqual(exported.input, input);
    assert.deepEqual(exported.result, prepared.result);
    assert.equal(exported.input_sha256, sha256(canonicalJson(exported.input)));
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.ok(f.reads.every((r: {
        filters: unknown[];
    }) => JSON.stringify(r.filters).includes('["user_id","owner"]')));
    assert.equal(f.audit[0].tax_calculation_id, id);
    f.failAudit = true;
    assert.equal((await m.GET(new Request(url))).status, 500);
    f.failAudit = false;
    f.row.result_sha256 = '0'.repeat(64);
    const audits = f.audit.length;
    assert.equal((await m.GET(new Request(url))).status, 500);
    assert.equal(f.audit.length, audits);
});
test('calculation server action authenticates, requires human confirmation, and computes totals before privileged capture', async () => {
    const current=accountingTaxPackFixture().calculation,currentPrepared=prepareCalculation(current.input);
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {reviewCalculation} from './app/dashboard/tax-prep/calculation/actions.ts';export {fixture} from 'test:db';" }, plugins: [{ name: 'inert-calculation-action', setup(b) {
                    b.onResolve({ filter: /^(next\/(navigation|cache)|@\/lib\/supabase\/(server|admin)|test:db)$/ }, a => ({ path: a.path.startsWith('next/') ? a.path : 'test:db', namespace: 'fixture' }));
                    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? "export function revalidatePath(){}" : `export const fixture={signedIn:true,calls:[],input:${JSON.stringify(current.input)},prior:null,rules:${JSON.stringify(rules)}};
    export function createAdminClient(){return {rpc:async(name,args)=>{fixture.calls.push({name,args,privileged:true});return {data:'${id}',error:null}}}}
    export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${current.input.owner_id}'}:null},error:null})},rpc:async(name,args)=>{fixture.calls.push({name,args});return {data:name==='read_tax_calculation_input'?fixture.input:{},error:null}},from(table){const q={select(){return q},eq(){return q},maybeSingle(){return Promise.resolve({data:fixture.prior,error:null})},single(){return Promise.resolve({data:fixture.rules,error:null})}};return q;}}}` }));
                } }] });
    const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')), f = m.fixture;
    const form = () => { const body = new FormData(); for (const [key, value] of Object.entries({ year: 2025, requestId: request, reason: 'Synthetic review', action: 'capture', humanConfirmed: 'yes', inputHash: currentPrepared.inputHash, resultHash: currentPrepared.resultHash, rulesHash: currentPrepared.rulesHash }))
        body.set(key, String(value)); return body; };
    f.signedIn = false;
    await assert.rejects(m.reviewCalculation(form()), /REDIRECT:\/login/);
    assert.equal(f.calls.length, 0);
    f.signedIn = true;
    const unconfirmed = form();
    unconfirmed.delete('humanConfirmed');
    await assert.rejects(m.reviewCalculation(unconfirmed), /error=/);
    assert.equal(f.calls.length, 0);
    const changed = form();
    changed.set('inputHash', '0'.repeat(64));
    await assert.rejects(m.reviewCalculation(changed), /error=/);
    assert.equal(f.calls.filter((c: {
        privileged?: boolean;
    }) => c.privileged).length, 0);
    f.calls = [];
    await assert.rejects(m.reviewCalculation(form()), new RegExp('saved=' + id));
    const captured = f.calls.find((c: {
        privileged?: boolean;
    }) => c.privileged);
    assert.equal(captured.args.p_owner, current.input.owner_id);
    assert.equal(captured.args.p_result, currentPrepared.resultJson);
    assert.equal(captured.args.p_input, currentPrepared.inputJson);
    f.prior = {...current,id,request_id:request,rationale:'Synthetic review'};
    f.input = { ...input, financial_stamp: 'changed' };
    f.calls = [];
    await assert.rejects(m.reviewCalculation(form()), new RegExp('saved=' + id));
    assert.equal(f.calls.length, 0);
});
test('calculation page withholds review forms when facts or invoice coverage change between complete reads',async()=>{
    const bank=accountingTaxPackFixture(),pageInput={...input,owner_id:bank.owner_id,schema_version:'tax-calculation-input/4',invoice_coverage:bank.invoice_coverage,bank_source_coverage:bank.bank_source_coverage};
    const root=fileURLToPath(new URL('../../',import.meta.url));const bundle=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',packages:'external',stdin:{resolveDir:root,contents:"export {default as Page} from './app/dashboard/tax-prep/calculation/page.tsx';export {fixture} from 'test:db';"},plugins:[{name:'inert-calculation-page',setup(b){
        b.onResolve({filter:/^(next\/(navigation|link)|@\/lib\/supabase\/server|test:db|\.\/CalculationReview)$/},a=>({path:a.path.startsWith('next/')||a.path==='./CalculationReview'?a.path:'test:db',namespace:'fixture'}));
        b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',resolveDir:root,contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}":a.path==='./CalculationReview'?"import React from 'react';export function CaptureReview(){return <div data-testid='capture-review-visible'/>}export function ScopeReview(){return <div data-testid='scope-review-visible'/>}":`export const fixture={signedIn:true,changed:false,coverageChanged:false,inputReads:0,stamps:0,input:${JSON.stringify(pageInput)}};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${bank.owner_id}'}:null},error:null})},rpc:async(name)=>({data:name==='read_tax_calculation_input'?(fixture.coverageChanged&&fixture.inputReads++?{...fixture.input,invoice_coverage:{...fixture.input.invoice_coverage,stamp:'c'.repeat(64)}}:fixture.input):(fixture.changed&&fixture.stamps++?'b':'a').repeat(32),error:null}),from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},gt(){return q},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}}}` }));
    }}]});
    // A file URL preserves native React resolution for this intentionally external dependency.
    const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const directory=await mkdtemp(root+'/.tax-page-test-');
    try{const path=directory+'/bundle.mjs';await writeFile(path,bundle.outputFiles[0].text);const m=await import('file://'+path),f=m.fixture;
        const params=()=>({searchParams:Promise.resolve({year:'2025'})});let html=renderToStaticMarkup(await m.Page(params()));assert.match(html,/capture-review-visible/);assert.match(html,/Incomplete/);
        f.changed=true;f.stamps=0;html=renderToStaticMarkup(await m.Page(params()));assert.match(html,/calculation-unavailable/);assert.ok(!html.includes('capture-review-visible'));assert.ok(!html.includes('scope-review-visible'));
        f.changed=false;f.coverageChanged=true;f.inputReads=0;html=renderToStaticMarkup(await m.Page(params()));assert.match(html,/calculation-unavailable/);assert.ok(!html.includes('capture-review-visible'));assert.ok(!html.includes('scope-review-visible'));
        f.coverageChanged=false;f.input.schema_version='tax-calculation-input/2';assert.match(renderToStaticMarkup(await m.Page(params())),/calculation-unavailable/);
        f.input=accountingTaxPackFixture(foreignTaxBankFixture()).calculation.input;html=renderToStaticMarkup(await m.Page(params()));assert.match(html,/KWD 10.001/);assert.match(html,/calculation-income_tax[^>]*>Unresolved/);assert.match(html,/bank-accounting-coverage/);
        delete f.input.bank_source_coverage;assert.match(renderToStaticMarkup(await m.Page(params())),/calculation-unavailable/);
        f.signedIn=false;await assert.rejects(m.Page(params()),/REDIRECT:\/login/);
    }finally{await rm(directory,{recursive:true,force:true});}
});
