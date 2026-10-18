import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { fxDocumentFactsFixture } from '../fx/document-facts-fixture';
import { fxFixtureId as id } from '../fx/fixture';
import { documentContext, encryptSource, sourceHash } from '../records/source-crypto';
let sequence = 0;
async function harness() {
  const f = fxDocumentFactsFixture(), bytes = Buffer.from('%PDF-1.7\nSynthetic external invoice\n%%EOF'), hash = sourceHash(bytes), key = randomBytes(32);
  f.source.document.file_sha256 = hash; f.source.document.size_bytes = bytes.length; f.invoice.source_snapshot.document_source = structuredClone(f.source); f.catalog.facts = [f.invoice]; f.catalog.counts.facts = 1;
  const cipher = encryptSource(bytes, key, documentContext(f.owner, hash)), root = fileURLToPath(new URL('../../', import.meta.url));
  const state = { owner: f.owner, catalog: f.catalog, clients: [{ id: id(200), user_id: f.owner, name: 'Synthetic client' }], invoices: [], signedIn: true, authFails: false, queryFails: false, catalogFails: false, stampDrift: false, stampReads: 0, keyFails: false, auditFails: false, captureFails: false, uncertain: false, prior: null, proof: null, calls: [], filters: [], audit: [], captures: [], key: [...key], cipher: [...cipher], metadata: { id: f.source.document.id, user_id: f.owner, file_hash: hash, media_type: 'application/pdf', size_bytes: bytes.length, object_path: f.owner + '/' + id(94) + '/0.enc', key_id: 'retained-v1' } };
  const result = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {captureExternalInvoice as action,createExternalInvoiceClient as clientAction} from './app/dashboard/reconciliation/fx/invoices/actions.ts';export {readExternalInvoiceContext as context,parseExternalHistory as history} from './lib/invoices/external-store.ts';export {fixture} from 'test:fixture';export {createClient as db} from '@/lib/supabase/server';" }, plugins: [{ name: 'external-action-fixture', setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|cache)|server-only|test:fixture|@\/lib\/supabase\/server)$|supabase\/admin$|records\/evidence-key$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
      a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : a.path === 'server-only' ? '' :
      a.path.endsWith('evidence-key') ? "import {fixture as f} from 'test:fixture';export function loadEvidenceKey(id){f.calls.push('key');if(f.keyFails)throw Error('PRIVATE_KEY');return{key:Buffer.from(f.key),keyId:id}}" :
      a.path === '@/lib/supabase/server' ? `import {fixture as f} from 'test:fixture';export async function createClient(){return{auth:{getUser:async()=>({data:{user:f.signedIn?{id:f.owner}:null},error:f.authFails?{}:null})},from(table){let after=null,eqs=[];const q={select(){return q},eq(k,v){eqs.push([k,v]);f.filters.push([table,k,v]);return q},order(){return q},limit(){return q},gt(k,v){after=v;return q},insert(row){f.calls.push('clientInsert');f.clients.push(row);return Promise.resolve({error:null})},async maybeSingle(){f.calls.push(table);return{data:table==='external_invoice_requests'?f.prior:f.clients.find(c=>eqs.every(([k,v])=>c[k]===v))||null,error:f.queryFails?{}:null}},then(resolve,reject){f.calls.push(table+':page');return Promise.resolve({data:(table==='clients'?f.clients:f.invoices).filter(r=>!after||r.id>after).slice(0,1),error:f.queryFails?{}:null}).then(resolve,reject)}};return q},async rpc(name,args){f.calls.push(name);if(name==='external_invoice_review_stamp')return{data:f.stampDrift&&++f.stampReads>1?'c'.repeat(32):f.catalog.stamp,error:null};if(name==='read_fx_evidence_catalog')return{data:f.catalog,error:f.catalogFails?{}:null};f.captures.push(args);if(f.captureFails)return{data:null,error:{}};const i=args.p_intent,r={schema_version:'external-invoice-result/1',invoice_id:i.invoice_id,revision_id:i.request_id,external_revision:i.expected_revision+1,source_fact_revision_id:i.source_fact_revision_id,recognized_income_change_pence:0,recognized_expense_change_pence:0,settlement_change:0};f.prior={intent:i,source_read_check_id:args.p_check,result:r};return{data:r,error:f.uncertain?{}:null}}}}` :
      a.path.endsWith('supabase/admin') ? `import {fixture as f} from 'test:fixture';export function createAdminClient(){f.calls.push('admin');return{from(table){const q={select(){return q},eq(){return q},async maybeSingle(){f.calls.push('private:'+table);return{data:table==='invoice_source_read_checks'?f.proof:f.metadata,error:null}}};return q},storage:{from(){return{download:async()=>{f.calls.push('download');return{data:new Blob([new Uint8Array(f.cipher)]),error:null}}}}},async rpc(name,args){f.calls.push('sourceAudit');f.audit.push(args);if(f.auditFails)return{data:null,error:{}};const r={id:'${id(96)}',user_id:f.owner,request_id:args.p_intent.request_id,intent:args.p_intent,fact_revision_id:args.p_intent.fact_revision_id,document_id:f.metadata.id,source_snapshot:args.p_source,outcome:args.p_outcome,author:f.owner,checked_at:'2026-10-18T10:00:00Z'};f.proof=r;return{data:r,error:null}}}}` :
      `export const fixture=${JSON.stringify(state)};` }));
  } }] });
  const m = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n// isolated ' + ++sequence).toString('base64'));
  const intent = { schema_version: 'external-invoice-intent/1', request_id: id(201), invoice_id: id(202), client_id: id(200), source_fact_revision_id: f.invoice.id, source_fact_family_id: f.invoice.family_id, expected_revision: 0, expected_updated_at: null, expected_stamp: f.catalog.stamp, original_sha256: hash, human_read_original: true, reason: 'Synthetic human original review' };
  function form() { const body = new FormData(); body.set('intent', JSON.stringify(intent)); body.set('humanConfirmed', 'yes'); return body; }
  return { ...m, intent, form };
}
test('external action authenticates and strictly bounds exact human intent before private access', async () => {
  const m = await harness(), f = m.fixture; f.signedIn = false; await assert.rejects(m.action(m.form()), /REDIRECT:\/login/); assert.deepEqual(f.calls, []); f.signedIn = true;
  for (const change of [(b: FormData) => b.delete('humanConfirmed'), (b: FormData) => b.append('intent', '{}'), (b: FormData) => b.set('intent', 'x'.repeat(8001)), (b: FormData) => b.set('intent', JSON.stringify({ ...m.intent, human_read_original: false })), (b: FormData) => b.set('raw', new Blob(['PRIVATE']), 'PRIVATE.pdf')]) {
    const b = m.form(); change(b); await assert.rejects(m.action(b), /error=review/); assert.deepEqual(f.calls, []);
  }
  await assert.rejects(m.action(m.form()), /result=saved/);
  assert.ok(f.calls.indexOf('download') < f.calls.indexOf('capture_external_invoice')); assert.equal(f.audit[0].p_intent.schema_version, 'invoice-source-read-intent/2'); assert.deepEqual(f.audit[0].p_intent.capture_intent, m.intent);
  assert.doesNotMatch(JSON.stringify(f.captures), /PRIVATE|\.enc|key_id/); assert.ok(f.filters.filter((r: string[]) => r[1] === 'user_id').every((r: string[]) => r[2] === f.owner));
});
test('private failures and context drift withhold capture; completed proof can survive rolled-back capture', async () => {
  for (const failure of ['keyFails','auditFails','catalogFails','queryFails','stampDrift','cipher']) {
    const m = await harness(), f = m.fixture; if (failure === 'cipher') f.cipher[30] ^= 1; else f[failure] = true;
    await assert.rejects(m.action(m.form()), /error=save/); assert.equal(f.captures.length, 0, failure);
  }
  const m = await harness(), f = m.fixture; f.captureFails = true; await assert.rejects(m.action(m.form()), /error=save/); assert.ok(f.proof); assert.equal(f.prior, null);
  f.captureFails = false; f.calls = []; await assert.rejects(m.action(m.form()), /result=saved/); assert.ok(!f.calls.includes('download')); assert.equal(f.captures.length, 2);
});
test('uncertain committed capture recovers exact intent before catalog, keys or objects; altered retry fails', async () => {
  const m = await harness(), f = m.fixture; f.uncertain = true; await assert.rejects(m.action(m.form()), /error=save/); assert.ok(f.prior);
  f.uncertain = false; f.catalogFails = true; f.keyFails = true; f.calls = [];
  await assert.rejects(m.action(m.form()), /result=saved/); assert.deepEqual(f.calls, ['external_invoice_requests','capture_external_invoice']);
  f.calls = []; const b = m.form(); b.set('intent', JSON.stringify({ ...m.intent, reason: 'Changed review' })); await assert.rejects(m.action(b), /error=save/); assert.deepEqual(f.calls, ['external_invoice_requests']);
});
test('context reads past server page caps and rejects foreign clients, missing relations and malformed heads', async () => {
  const m = await harness(), f = m.fixture; f.clients.push({ id: id(210), user_id: f.owner, name: 'Another synthetic client' }); const context = await m.context(await db(m), f.owner); assert.equal(context.clients.length, 2);
  f.clients[1].user_id = id(900); await assert.rejects(m.context(await db(m), f.owner), /Owned client/); f.clients.pop();
  f.invoices.push({ id: id(202), user_id: f.owner, client_id: id(900), origin: 'preserved_external', status: 'finalised', currency: 'GBP', amount: null, original_total_minor: 100, currency_ruleset_id: 'vibecount-currencies/1', source_fact_revision_id: m.intent.source_fact_revision_id, source_fact_family_id: m.intent.source_fact_family_id, external_revision: 1, updated_at: '2026-10-18T00:00:00Z', number: 'SYNTHETIC', invoice_date: '2026-04-05' });
  await assert.rejects(m.context(await db(m), f.owner), /family\/client/); f.invoices[0].client_id = id(200); assert.equal((await m.context(await db(m), f.owner)).invoices[0].original_total_minor, 100);
  f.invoices[0].original_total_minor = null; await assert.rejects(m.context(await db(m), f.owner), /amount/);
});
// Exported fixture client uses the same actual stores with no network or hosted writes.
async function db(m: Awaited<ReturnType<typeof harness>>) {
  return m.db();
}
test('client metadata review is separate, authenticated, bounded and idempotent for unchanged labels', async () => {
  const m = await harness(), f = m.fixture;
  function body() { const b = new FormData(); b.set('clientId', id(250)); b.set('name', 'Reviewed synthetic label'); b.set('humanConfirmed', 'yes'); return b; }
  f.signedIn = false; await assert.rejects(m.clientAction(body()), /REDIRECT:\/login/); assert.equal(f.clients.length, 1); f.signedIn = true;
  for (const change of [(b: FormData) => b.delete('humanConfirmed'), (b: FormData) => b.append('name', 'Extra'), (b: FormData) => b.set('name', 'x'.repeat(201)), (b: FormData) => b.set('clientId', 'bad'), (b: FormData) => b.set('raw', new Blob(['PRIVATE']), 'PRIVATE.pdf')]) { const b = body(); change(b); await assert.rejects(m.clientAction(b), /error=client/); assert.equal(f.clients.length, 1); }
  await assert.rejects(m.clientAction(body()), /client=saved/); await assert.rejects(m.clientAction(body()), /client=saved/); assert.equal(f.clients.length, 2); assert.equal(f.calls.filter((c: string) => c === 'clientInsert').length, 1); assert.equal(f.captures.length, 0); assert.equal(f.audit.length, 0);
  const changed = body(); changed.set('name', 'Changed label'); await assert.rejects(m.clientAction(changed), /error=client/); assert.equal(f.clients[1].name, 'Reviewed synthetic label');
});

test('historical originals reject malformed dates, zero/negative units and foreign provenance without exposing extra source fields', async () => {
  const m = await harness(), f = m.fixture;
  const row = { id: id(201), user_id: f.owner, author: f.owner, invoice_id: id(202), version: 1, origin: 'preserved_external', source_fact_revision_id: id(50), source_read_check_id: id(96), created_at: '2026-10-18T00:00:00Z', snapshot: { schema_version: 'preserved-external-invoice/1', invoice_id: id(202), external_revision: 1, source_fact_revision_id: id(50), currency: 'KWD', original_total_minor: 10001, number: 'SYNTHETIC', invoice_date: '2026-04-05', raw: 'PRIVATE' } };
  assert.equal(m.history(f.owner, [row])[0].original_total_minor, 10001); assert.doesNotMatch(JSON.stringify(m.history(f.owner, [row])), /PRIVATE|raw/);
  for (const patch of [{ original_total_minor: 0 }, { original_total_minor: -1 }, { invoice_date: '2026-02-30' }, { currency: 'INVALID' }]) assert.throws(() => m.history(f.owner, [{ ...row, snapshot: { ...row.snapshot, ...patch } }]));
  assert.throws(() => m.history(id(900), [row])); assert.throws(() => m.history(f.owner, [row, row]));
});
