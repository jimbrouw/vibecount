import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeSourceContext,parseSourceEnvelope,requireNativeProjection,requireSourceConfirmation } from './native-source-context';
import { nativeSourceContextFixture,connectedReviewFixture } from './native-source-fixture';
import { refundClosureFixture,splitRefundFixture,refundFixtureId as id } from './refund-split-fixture';
import { importReversalFixture } from './import-reversal-fixture';
import { readCurrentRefundClosure,readCurrentRefundSplit,readCurrentImportReversal,readCurrentAssignmentContext } from './native-connected-store';
const client=(data:unknown)=>({rpc:async()=>({data,error:null})});
test('current source context reconstructs exact safe dimensions and rejects contradictory or partial metadata',()=>{
 const f=splitRefundFixture(),raw=nativeSourceContextFixture(f.owner,f.catalog.stamp,f.catalog.transactions),context=parseNativeSourceContext(f.owner,raw);
 assert.equal(context.blocked,false);assert.equal(context.counts.sources,3);assert.deepEqual(parseNativeSourceContext(f.owner,{...raw,PRIVATE:'not forwarded'}),context);
 for(const change of [(r:typeof raw)=>r.counts.sources++,(r:typeof raw)=>r.sources.push(r.sources[0]),(r:typeof raw)=>{r.sources[0].user_id=id(999)},(r:typeof raw)=>{r.sources[0].signed_amount_pence='1e2'},(r:typeof raw)=>{r.sources[0].account_currency='KWD'},(r:typeof raw)=>{r.sources[0].parser_version=null as never},(r:typeof raw)=>{r.sources[0].cash_date='2026-02-30'},(r:typeof raw)=>{r.source_stamp='bad'}]){const r=structuredClone(raw);change(r);assert.throws(()=>parseNativeSourceContext(f.owner,r))}
 const lost=structuredClone(raw);lost.sources[0].source_available=false;lost.counts.unavailable_sources=1;assert.equal(parseNativeSourceContext(f.owner,lost).blocked,false);
 const form=new FormData();assert.throws(()=>requireSourceConfirmation(form,context));form.set('sourceStamp','a'.repeat(64));requireSourceConfirmation(form,context);form.append('sourceStamp','a'.repeat(64));assert.throws(()=>requireSourceConfirmation(form,context));form.set('sourceStamp','b'.repeat(64));assert.throws(()=>requireSourceConfirmation(form,context));
 const mismatch=structuredClone(f.catalog.transactions);mismatch[0].signed_amount_pence=999;assert.throws(()=>requireNativeProjection(context,mismatch,mismatch.map(s=>s.id),context.financial_stamp));
});
test('unsupported raw split inventory remains outside native arithmetic while selected unsupported sources withhold it',async()=>{
 const f=splitRefundFixture(),foreign={...f.original,id:id(888),source_row_id:id(889),account_id:id(890),currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',source_units_ruleset:'vibecount-currencies/1'};
 const raw=connectedReviewFixture('split',f.catalog,{id:f.refund.id},[],[foreign]),r=await readCurrentRefundSplit(client(raw),f.owner,f.refund.id);
 assert.equal(r.blocked,false);assert.equal(r.source_context.blocked,true);assert.equal(r.native_catalog!.transactions.length,3);assert.equal(r.source_context.sources.find(s=>s.id===foreign.id)!.original_signed_minor,'10001');
 const selected=connectedReviewFixture('split',{...f.catalog,transactions:[foreign]},{id:foreign.id});assert.equal((await readCurrentRefundSplit(client(selected),f.owner,foreign.id)).native_catalog,null);
 const invalid=structuredClone(selected);assert.ok('native_context' in invalid);invalid.native_context=f.catalog as never;await assert.rejects(readCurrentRefundSplit(client(invalid),f.owner,foreign.id),/withheld/);
 const omitted=structuredClone(raw);omitted.source_context.sources.pop();omitted.source_context.counts.sources--;omitted.source_context.counts.native_blockers--;omitted.source_context.blocked=false;assert.throws(()=>parseSourceEnvelope(f.owner,omitted),/scope|counts/);
});
test('closure/import raw eligibility and native operation scopes are independently complete with no blocked totals',async()=>{
 const graph=refundClosureFixture(),raw=connectedReviewFixture('closure',graph,{kind:'original',id:id(100)}),native=await readCurrentRefundClosure(client(raw),graph.owner_id,{kind:'original',id:id(100)});assert.ok(native.native_review);
 const bad=structuredClone(raw);bad.dependencies.sources.pop();await assert.rejects(readCurrentRefundClosure(client(bad),graph.owner_id,{kind:'original',id:id(100)}));
 const foreign={...graph.transactions[0],id:id(888),source_row_id:id(889),currency:'JPY',signed_amount_pence:null,original_signed_minor:'1',source_units_ruleset:'vibecount-currencies/1'};
 const blocked=connectedReviewFixture('closure',graph,{kind:'original',id:id(100)},[],[foreign]);assert.equal((await readCurrentRefundClosure(client(blocked),graph.owner_id,{kind:'original',id:id(100)})).native_review,null);
 const imp=importReversalFixture(),extra={...imp.transactions[0],id:id(880),source_row_id:id(881)},envelope=connectedReviewFixture('import',imp,{},[],[extra]);
 const current=await readCurrentImportReversal(client(envelope),imp.owner_id,imp.import_id);assert.ok(current.native_review);assert.equal(current.source_context.counts.sources,current.operation_source_ids.length+1);
 assert.ok('operation_source_ids' in envelope);envelope.operation_source_ids!.pop();await assert.rejects(readCurrentImportReversal(client(envelope),imp.owner_id,imp.import_id),/scope/);
});
test('assignment context requires both actual source endpoints and rejects legacy or optimistic blockers',async()=>{
 const f=splitRefundFixture(),native={owner_id:f.owner,stamp:f.catalog.stamp,transactions:[f.original,f.refund]},raw=connectedReviewFixture('assignment',native,{allocation:id(400),refund:id(401)});
 assert.equal((await readCurrentAssignmentContext(client(raw),f.owner,id(400),id(401))).source_context.sources.length,2);
 const wrong=structuredClone(raw);wrong.schema_version='refund-assignment-context/1';await assert.rejects(readCurrentAssignmentContext(client(wrong),f.owner,id(400),id(401)));
 const blocked=connectedReviewFixture('assignment',native,{allocation:id(400),refund:id(401)},[f.refund.id]);assert.equal((await readCurrentAssignmentContext(client(blocked),f.owner,id(400),id(401))).blocked,true);
 blocked.blocked=false;await assert.rejects(readCurrentAssignmentContext(client(blocked),f.owner,id(400),id(401)));
});
