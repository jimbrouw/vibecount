import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { refundFixtureId as id } from './refund-split-fixture';
import {bankSourceCoverageFixture} from './bank-source-coverage-fixture';

test('refund evidence links open an exact owned source beyond pagination and preserve import scope', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url)), directory = await mkdtemp(join(root, '.source-focus-test-'));
    try {
        const b = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom/server'], stdin: { resolveDir: root, contents: `import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/imports/page.tsx';export async function render(params={}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {fixture} from 'test:db';` }, plugins: [{ name: 'source-review-boundaries', setup(b) {
            b.onResolve({ filter: /^(next\/(navigation|link)|@\/lib\/supabase\/server|@\/lib\/records\/categories|test:db|\.\/(ImportWizard|DocumentIntake|actions))$/ }, a => ({ path: a.path === '@/lib/supabase/server' ? 'test:db' : a.path, namespace: 'fixture' }));
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => {
                if (a.path === 'next/navigation') return { contents: "export function redirect(url){throw new Error('REDIRECT:'+url)}" };
                if (a.path === 'next/link') return { contents: "import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}" };
                if (a.path === '@/lib/records/categories') return { contents: 'export async function ensureRecordCategories(){return []}' };
                if (['./ImportWizard', './DocumentIntake'].includes(a.path)) return { contents: 'export default function Component(){return null}' };
                if (a.path === './actions') return { contents: 'export async function createFinancialAccount(){}export async function reverseSourceImport(){}export async function reopenSourceImport(){}export async function classifySourceTransaction(){}' };
                return { contents: `
const owner='${id(1)}',imp='${id(10)}';const rows=Array.from({length:60},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+100).padStart(12,'0'),user_id:owner,import_id:imp,transaction_date:'2026-04-06',signed_amount_pence:100,currency:'GBP',original_signed_minor:null,source_units_ruleset:null,description:'Synthetic source '+i,reference:'',classification:'Unknown',decision_version:0,business_use_bps:0,category_id:null,dedupe_status:'clear',source_row_id:'00000000-0000-4000-8000-'+String(i+800).padStart(12,'0'),active_transfer_id:null,active_refund_id:null,has_refunds:false}));
export const fixture={signedIn:true,calls:[]};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:owner}:null}})},rpc:async(name)=>name==='read_bank_source_coverage'?({data:${JSON.stringify(bankSourceCoverageFixture(id(1),60,2026))},error:null}):({data:{transactions:60,income_pence:0,expense_pence:0,stamp:'a'.repeat(32),allocation_count:0,refund_count:0,transfer_count:0,retained_duplicate_count:0,refund_assignment_count:0},error:null}),from(table){const filters=[];let cursor=null;let limit=100;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},not(){return q},order(){return q},range(){return q},limit(n){limit=n;return q},gt(k,v){cursor=v;return q},async maybeSingle(){return {data:{id:imp,status:'review'},error:null}},then(resolve){fixture.calls.push({table,filters,cursor});let data=table==='refund_source_transactions'?rows.filter(r=>filters.every(([k,v])=>r[k]===v)&&(!cursor||r.id>cursor)).slice(0,limit):table==='financial_accounts'?[{id:'${id(20)}',currency:'GBP',label:'Synthetic bank',provider:'generic',masked_identifier:'1234'}]:table==='record_imports'?[{id:imp,original_filename:'synthetic.csv',file_hash:'a'.repeat(64),parser_version:'mapped-csv/1',coverage_start:'2026-04-06',coverage_end:'2026-04-06',metadata:{},status:'review'}]:[];return Promise.resolve({data,error:null}).then(resolve)}};return q}}}` };
            });
        } }] });
        const path = join(directory, 'fixture.mjs'); await writeFile(path, b.outputFiles[0].text); const m = await import(pathToFileURL(path).href), f = m.fixture;
        f.signedIn = false; await assert.rejects(m.render({ import: id(10), transaction: id(153) }), /REDIRECT:\/login/); assert.equal(f.calls.length, 0); f.signedIn = true;
        const normal = await m.render({ import: id(10) }); assert.ok(!normal.includes(`source-transaction-${id(153)}`));
        f.calls = []; const focused = await m.render({ import: id(10), transaction: id(153), after: id(159) });
        assert.match(focused, new RegExp(`id="transaction-${id(153)}"`)); assert.match(focused, /Synthetic source 53/); assert.match(focused, /source-all-transactions/);
        const query = f.calls.find((c: { table: string }) => c.table === 'refund_source_transactions'); assert.deepEqual(query.filters, [['user_id', id(1)], ['import_id', id(10)], ['id', id(153)]]); assert.equal(query.cursor, null);
        assert.ok(!(await m.render({ import: id(11), transaction: id(153) })).includes(`source-transaction-${id(153)}`));
        f.calls = []; await m.render({ import: id(10), transaction: 'invalid' }); assert.ok(!f.calls.find((c: { table: string }) => c.table === 'refund_source_transactions').filters.some((v: string[]) => v[0] === 'id'));
    } finally { await rm(directory, { recursive: true, force: true }); }
});
