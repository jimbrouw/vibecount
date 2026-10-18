import assert from 'node:assert/strict';
import test from 'node:test';
import { fxReviewedFixture } from './reviewed-request-fixture';
import { parseFxReviewedRequest,parseFxReviewedResult } from './reviewed-request';
import { fxFixtureId as id } from './fixture';
test('saved review/result parsers bind owner, full intent, exact cash/currency/tranches and complete reversal portions',()=>{
 for(const kind of ['allocate','reverse'] as const){const f=fxReviewedFixture(kind),saved=parseFxReviewedRequest(f.owner,f.raw);assert.deepEqual(parseFxReviewedResult(f.result,saved.review),f.result);
  const completed={...f.raw,state:'completed',result:f.result};assert.equal(parseFxReviewedRequest(f.owner,completed).state,'completed');
  for(const patch of [{state:'completed'},{state:['prepared']},{result:{}},{request:{...f.raw.request,user_id:id(999)}},{request:{...f.raw.request,request_id:id(999)}}])assert.throws(()=>parseFxReviewedRequest(f.owner,{...f.raw,...patch}));
  const source=structuredClone(f.raw);source.request.review_snapshot.receipt.signed_cash_pence++;assert.throws(()=>parseFxReviewedRequest(f.owner,source));
  for(const patch of [{recognized_income_change_pence:1},{recognized_expense_change_pence:1},{schema_version:'unknown'},{private:'PRIVATE'}])assert.throws(()=>parseFxReviewedResult({...f.result,...patch},saved.review));
  const bad=structuredClone(completed);if(kind==='allocate'){const result=bad.result as {rows:{snapshot:Record<string,unknown>}[]};result.rows[0].snapshot.receipt_record_id=id(999);}else (bad.result as {lot_version:number}).lot_version++;
  assert.throws(()=>parseFxReviewedRequest(f.owner,bad));
 }
});
