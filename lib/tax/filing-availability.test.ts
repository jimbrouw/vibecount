import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingTaxPackFixture } from './bank-source-fixture';
import { reviewFixture } from './filing-pack-fixture';
import { buildFilingPack, buildFilingReview, validatePackInput, verifyFilingPack, type FilingPackInput, type SavedFilingPack } from './filing-pack';
import { canonicalJson, sha256 } from './snapshot';

function fixture(): Extract<FilingPackInput, {schema_version:'filing-pack-input/6'}> {
    return {...accountingTaxPackFixture(), schema_version:'filing-pack-input/6',
        documents:[{id:'document-1',file_hash:'a'.repeat(64),source_available:true}]};
}
function save(input:FilingPackInput): SavedFilingPack {
    const bundle=buildFilingPack(input,reviewFixture(input),'request',true);
    const inputJson=canonicalJson(input), bundleJson=canonicalJson(bundle);
    return {id:'pack',tax_year_start:2025,input,input_canonical_json:inputJson,input_sha256:sha256(inputJson),
        bundle,bundle_canonical_json:bundleJson,bundle_sha256:sha256(bundleJson),reason:'Synthetic',author:input.owner_id,created_at:'2026-10-18',request_id:'request'};
}

test('filing input 6 requires explicit boolean availability for every document',()=>{
    for(const value of [undefined,null,0,1,'true','false',{}]) {
        const input=fixture();
        (input.documents[0] as Record<string,unknown>).source_available=value;
        assert.throws(()=>validatePackInput(input),/availability must be an explicit boolean/);
    }
    validatePackInput(fixture());
    const unavailable=fixture();unavailable.documents[0].source_available=false;
    validatePackInput(unavailable);
});

test('unavailable document invalidates sources review and completeness even after re-review',()=>{
    const input=fixture(),history=reviewFixture(input);
    assert.equal(buildFilingReview(input,history).canAttest,true);
    input.documents[0].source_available=false;
    const changed=buildFilingReview(input,history);
    assert.equal(changed.steps.find(step=>step.id==='sources')!.review,null);
    assert.equal(changed.canAttest,false);
    assert.deepEqual(changed.issues.find(issue=>issue.code==='document_source_unavailable')?.source_ids,['document-1']);
    const fresh=reviewFixture(input);
    assert.equal(buildFilingReview(input,fresh).canAttest,false);
    assert.throws(()=>buildFilingPack(input,fresh,'request',true),/prevent completeness/);
    const draft=buildFilingPack(input,fresh,'request',false);
    assert.equal(draft.schema_version,'draft-filing-pack/7');
    const evidence=JSON.parse(draft.artifacts.find(artifact=>artifact.name==='evidence-manifest.json')!.body);
    assert.deepEqual(evidence.documents,input.documents);
});

test('version 7 preserves document availability provenance and verifies frozen available evidence',()=>{
    const saved=save(fixture());
    assert.equal(verifyFilingPack(saved).schema_version,'draft-filing-pack/7');
    const artifact=saved.bundle.artifacts.find(item=>item.name==='evidence-manifest.json')!;
    const evidence=JSON.parse(artifact.body);
    evidence.documents[0].source_available=false;
    artifact.body=canonicalJson(evidence);artifact.sha256=sha256(artifact.body);artifact.size_bytes=Buffer.byteLength(artifact.body);
    saved.bundle_canonical_json=canonicalJson(saved.bundle);saved.bundle_sha256=sha256(saved.bundle_canonical_json);
    assert.throws(()=>verifyFilingPack(saved),/document availability provenance/);
});

test('legacy input 5 retains exact version 6 output without new availability requirement',()=>{
    const input=accountingTaxPackFixture();
    input.documents=[{id:'legacy-document',file_hash:'a'.repeat(64)}];
    const saved=save(input);
    assert.equal(verifyFilingPack(saved).schema_version,'draft-filing-pack/6');
    assert.equal(canonicalJson(buildFilingPack(input,saved.bundle.reviews,'request',true)),saved.bundle_canonical_json);
    const evidence=JSON.parse(saved.bundle.artifacts.find(artifact=>artifact.name==='evidence-manifest.json')!.body);
    assert.equal(Object.hasOwn(evidence.documents[0],'source_available'),false);
});
