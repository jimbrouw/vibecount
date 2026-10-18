import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { fxDocumentFactsFixture } from './document-facts-fixture';
import { fxFixtureId as id } from './fixture';
import { encryptSource, documentContext, sourceHash } from '../records/source-crypto';
let sequence = 0;
async function harness() {
  const f = fxDocumentFactsFixture(), bytes = Buffer.from('%PDF-1.7\nSynthetic readable invoice\n%%EOF'), hash = sourceHash(bytes), key = randomBytes(32);
  f.source.document.file_sha256 = hash; f.source.document.size_bytes = bytes.length; f.invoice.source_snapshot.document_source = structuredClone(f.source); f.catalog.facts = [f.invoice]; f.catalog.counts.facts = 1;
  const cipher = encryptSource(bytes, key, documentContext(f.owner, hash)), root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: "export {checkInvoiceRetainedSource as action} from './app/dashboard/reconciliation/fx/evidence/source-actions.ts';export {fixture} from 'test:fixture';" }, plugins: [{ name: 'private-source-action', setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|cache)|server-only|test:fixture|@\/lib\/supabase\/server)$|supabase\/admin$|records\/evidence-key$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/navigation' ? "export function redirect(url){throw new Error('REDIRECT:'+url)}" : a.path === 'next/cache' ? 'export function revalidatePath(){}' : a.path === 'server-only' ? '' : a.path.endsWith('evidence-key') ? `import {fixture} from 'test:fixture';export function loadEvidenceKey(id){fixture.calls.push('key:'+id);if(fixture.keyFails)throw new Error('PRIVATE_KEY');return{key:Buffer.from(fixture.key),keyId:id}}` : a.path === '@/lib/supabase/server' ? `import {fixture} from 'test:fixture';export async function createClient(){return{auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:fixture.owner}:null},error:fixture.authFails?{}:null})},rpc:async()=>{fixture.calls.push('catalog');return{data:fixture.catalog,error:fixture.catalogFails?{}:null}}}}` : a.path.endsWith('supabase/admin') ? `import {fixture} from 'test:fixture';export function createAdminClient(){fixture.calls.push('admin');if(fixture.noDb)return null;return{from(table){const q={select(){return q},eq(k,v){fixture.filters.push([table,k,v]);return q},async maybeSingle(){fixture.calls.push(table);return{data:table==='invoice_source_read_checks'?fixture.prior:fixture.metadata,error:fixture.queryFails?{message:'PRIVATE_QUERY'}:null}}};return q},storage:{from(bucket){return{download:async(path)=>{fixture.calls.push('download');fixture.downloads.push({bucket,path});return{data:new Blob([fixture.cipher]),error:fixture.downloadFails?{message:'PRIVATE_PATH'}:null}}}}},rpc:async(name,args)=>{fixture.calls.push('audit');fixture.audit.push(args);if(fixture.auditFails)return{data:null,error:{message:'PRIVATE_AUDIT'}};return{error:null,data:fixture.forgedResult?{}:{id:'${id(96)}',user_id:fixture.owner,request_id:args.p_intent.request_id,intent:args.p_intent,fact_revision_id:args.p_intent.fact_revision_id,document_id:fixture.metadata.id,source_snapshot:args.p_source,outcome:args.p_outcome,author:fixture.owner,checked_at:'2026-10-18T10:00:00Z'}}}}}` : `export const fixture={owner:'${f.owner}',catalog:${JSON.stringify(f.catalog)},metadata:${JSON.stringify({ id: f.source.document.id, user_id: f.owner, file_hash: hash, media_type: 'application/pdf', size_bytes: bytes.length, object_path: f.owner + '/' + id(94) + '/0.enc', key_id: 'retained-v1' })},key:${JSON.stringify([...key])},cipher:new Uint8Array(${JSON.stringify([...cipher])}),signedIn:true,authFails:false,noDb:false,catalogFails:false,keyFails:false,queryFails:false,downloadFails:false,auditFails:false,forgedResult:false,prior:null,calls:[],filters:[],downloads:[],audit:[]};` }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n// isolated ' + ++sequence).toString('base64'));
}
function form() { const f = new FormData(); f.set('requestId', id(95)); f.set('factId', id(50)); f.set('reason', 'Check retained invoice'); f.set('humanConfirmed', 'yes'); return f; }
test('retained-source action authenticates and bounds exact human transport before private access', async () => {
  const m = await harness(), f = m.fixture; f.signedIn = false; await assert.rejects(m.action(form()), /REDIRECT:\/login/); assert.deepEqual(f.calls, []); f.signedIn = true;
  for (const mutate of [(x: FormData) => x.delete('humanConfirmed'), (x: FormData) => x.append('factId', id(50)), (x: FormData) => x.set('reason', 'x'.repeat(1201)), (x: FormData) => x.set('factId', 'bad'), (x: FormData) => x.set('raw', new Blob(['PRIVATE']), 'PRIVATE.pdf')]) {
    const bad = form(); mutate(bad); await assert.rejects(m.action(bad), /sourceCheck=invalid/); assert.deepEqual(f.calls, []);
  }
  const good = form(); good.set('$ACTION_ID_framework', 'metadata'); await assert.rejects(m.action(good), /sourceCheck=verified/);
  assert.ok(f.filters.every((r: string[]) => r[1] !== 'user_id' || r[2] === f.owner)); assert.equal(f.downloads[0].bucket, 'document-evidence');
  assert.equal(f.audit[0].p_outcome, 'verified'); assert.doesNotMatch(JSON.stringify(f.audit), /PRIVATE|\.enc|key_id/);
});
test('private source failures are audited unavailable; invalid context/audit/config never claims success', async () => {
  for (const failure of ['keyFails', 'downloadFails', 'size', 'foreign', 'catalogFails', 'auditFails', 'forgedResult', 'noDb', 'queryFails']) {
    const m = await harness(), f = m.fixture;
    if (failure === 'size') f.cipher = new Uint8Array(3000030); else if (failure === 'foreign') f.metadata.user_id = id(99); else f[failure] = true;
    await assert.rejects(m.action(form()), e => { assert.match((e as Error).message, /sourceCheck=(unavailable|error)/); assert.doesNotMatch((e as Error).message, /PRIVATE/); return true; });
    if (['keyFails', 'downloadFails', 'size', 'foreign'].includes(failure)) assert.equal(f.audit[0].p_outcome, 'unavailable', failure);
    if (failure === 'foreign') assert.equal(f.downloads.length, 0);
  }
});
test('exact past source check recovers before catalog, keys or objects and changed review rejects', async () => {
  const m = await harness(), f = m.fixture; await assert.rejects(m.action(form()), /sourceCheck=verified/);
  const args = f.audit[0]; f.prior = { id: id(96), user_id: f.owner, request_id: id(95), intent: args.p_intent, fact_revision_id: id(50), document_id: f.metadata.id, source_snapshot: args.p_source, outcome: 'verified', author: f.owner, checked_at: '2026-10-18T10:00:00Z' };
  f.calls = []; f.keyFails = true; f.catalogFails = true; f.downloadFails = true;
  await assert.rejects(m.action(form()), /sourceCheck=verified/); assert.deepEqual(f.calls, ['admin', 'invoice_source_read_checks']);
  const changed = form(); changed.set('reason', 'Changed retained check'); await assert.rejects(m.action(changed), /sourceCheck=error/);
});
