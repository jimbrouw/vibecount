import assert from 'node:assert/strict';
import test from 'node:test';
import { bankValuationIntent, bankValuationData, parseBankValuationRevision } from './bank-valuation';
import { convertCurrencyMinor, rateFromDecimal } from '../fx/currency';
const id=(n:number)=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0'),owner=id(1);
function fixture(original=-10001, code:'KWD'|'JPY'='KWD', decimal='2.5'){
 const data={method:'documented_rate/1',rate:rateFromDecimal(code,'GBP',decimal),valuation_date:'2026-04-06',evidence_date:'2026-04-07'},conversion=convertCurrencyMinor(original,data.rate);
 const economic={schema_version:'bank-economic-source/1',owner_id:owner,transaction_id:id(2),account_id:id(3),account_currency:code,import_id:id(4),source_file_id:id(5),file_sha256:'a'.repeat(64),size_bytes:100,parser_version:'mapped-csv/2',source_row_id:id(6),row_number:2,row_sha256:'b'.repeat(64),cash_date:'2026-04-05',currency:code,original_signed_minor:original,ruleset_id:'vibecount-currencies/1'};
 const source={economic_source:economic,document_source:{document:{id:id(7),file_sha256:'c'.repeat(64),media_type:'application/pdf',size_bytes:80},available:true,invoice_scope:false,registration:{item_id:id(8),batch_id:id(9),ordinal:0,purpose:'other',tax_year_start:2025}}};
 const intent={schema_version:'bank-valuation-intent/1',ruleset_id:'vibecount-currencies/1',transaction_id:id(2),transaction_version:0,expected_ordinal:0,state:'reviewed',document_id:id(7),data,human_read_original:true,expected_stamp:'a'.repeat(32),rationale:'Synthetic valuation',request_id:id(10)};
 const revision={id:id(11),user_id:owner,family_id:id(12),ordinal:1,previous_revision_id:null,state:'reviewed',transaction_version:0,ruleset_id:'vibecount-currencies/1',document_id:id(7),data,source_snapshot:source,conversion,signed_gbp_pence:conversion.target_minor,human_read_original:true,reviewed_stamp:'a'.repeat(32),rationale:'Synthetic valuation',author:owner,request_id:id(10),created_at:'2026-10-18T00:00:00+00:00'};
 return{data,intent,revision,source,economic};
}
test('retained valuation parses its own safe output with signed, zero and exact original dimensions',()=>{
 for(const [original,code,decimal,expected] of [[-10001,'KWD','2.5',-2500],[10001,'KWD','2.5',2500],[1,'KWD','0.01',0],[-1,'JPY','0.005',-1]] as const){
  const f=fixture(original,code,decimal),r=parseBankValuationRevision(owner,f.revision);
  assert.equal(r.signed_gbp_pence,expected);assert.equal(r.source_snapshot.economic_source.original_signed_minor,original);
  assert.equal(r.source_snapshot.economic_source.cash_date,'2026-04-05');assert.equal(r.data.valuation_date,'2026-04-06');
  assert.deepEqual(parseBankValuationRevision(owner,r),r);
 }
});
test('intent types, exact fields, source-to-GBP rate direction, dates and original read are strict',()=>{
 const f=fixture();assert.deepEqual(bankValuationIntent(f.intent),f.intent);
 for(const patch of [{state:['reviewed']},{state:null},{human_read_original:1},{human_read_original:false},{transaction_version:'0'},{expected_ordinal:2147483647},{document_id:null},{expected_stamp:'b'.repeat(31)},{private_key:'hidden'},
  {data:{...f.data,rate:rateFromDecimal('GBP','KWD','2.5')}},{data:{...f.data,method:['documented_rate/1']}},{data:{...f.data,valuation_date:'2026-02-31'}},
  {data:{...f.data,evidence_date:' 2026-04-07'}},{data:{...f.data,rate:{...f.data.rate,denominator:'0'}}}])assert.throws(()=>bankValuationIntent({...f.intent,...patch}));
 assert.throws(()=>bankValuationData({...f.data,gbp_pence:2500}));
 assert.match(bankValuationIntent({...f.intent,rationale:'Account 12345678 checked'}).rationale,/redacted/);
 const normal=bankValuationIntent({...f.intent,data:{...f.data,rate:{...f.data.rate,numerator:'10',denominator:'4'}}});
 assert.equal(normal.data!.rate.numerator,'5');assert.equal(normal.data!.rate.denominator,'2');
});
test('retained history rejects forged owner, evidence, original amount, coherent altered GBP results and enum coercion',()=>{
 const f=fixture();
 for(const patch of [{user_id:id(20)},{author:id(20)},{state:['reviewed']},{human_read_original:0},{ordinal:0},{ordinal:2},{transaction_version:NaN},{request_id:'no'},{document_id:id(30)},{signed_gbp_pence:2500},{signed_gbp_pence:-2500.01},
  {conversion:{...f.revision.conversion,target_minor:1}},{source_snapshot:{...f.source,economic_source:{...f.economic,account_currency:'USD'}}},
  {source_snapshot:{...f.source,economic_source:{...f.economic,owner_id:id(20)}}},
  {source_snapshot:{...f.source,economic_source:{...f.economic,currency:'GBP',account_currency:'GBP'}}},
  {source_snapshot:{...f.source,economic_source:{...f.economic,original_signed_minor:10001}}},
  {source_snapshot:{...f.source,economic_source:{...f.economic,parser_version:'mapped-csv/1'}}},
  {source_snapshot:{...f.source,economic_source:{...f.economic,row_number:1}}},
  {source_snapshot:{...f.source,raw_encrypted:'PRIVATE'}},{created_at:'yesterday'},{object_path:'PRIVATE'}])assert.throws(()=>parseBankValuationRevision(owner,{...f.revision,...patch}));
});
test('withdrawal retains old economics and sources without pretending current eligibility or requiring a fresh source',()=>{
 const f=fixture(),intent=bankValuationIntent({...f.intent,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false,expected_ordinal:1});
 assert.equal(intent.data,null);assert.equal(intent.transaction_version,null);
 for(const patch of [{data:f.data},{human_read_original:true},{document_id:id(7)},{transaction_version:0}])assert.throws(()=>bankValuationIntent({...intent,...patch}));
 const r=parseBankValuationRevision(owner,{...f.revision,state:'withdrawn',human_read_original:false,ordinal:2,previous_revision_id:id(30)});
 assert.deepEqual(r.source_snapshot,f.source);assert.equal(r.signed_gbp_pence,-2500);
 assert.equal(Object.hasOwn(r,'source_current'),false);
});
