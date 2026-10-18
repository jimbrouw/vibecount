import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { dimensionedSourcePlan,persistDimensionedSourceCsv,verifyDimensionedSourceRecovery,type DimensionedSourceAttempt,type PreparedDimensionedSourceRow } from './source-persistence-v2';
import { readSourceCsv,suggestMapping } from './source-csv';
import { decryptSource,sourceContext,sourceHash } from './source-crypto';
function harness(currency='KWD',amount='10.001'){
 const bytes=Buffer.from(`Date,Description,Amount,Currency\r\n05/04/2026,Synthetic purchase,-${amount},${currency}\r\n05/04/2026,Synthetic purchase,-${amount},${currency}\r\n06/04/2026,Synthetic income,${amount},${currency}\r\n`),mapping=suggestMapping(readSourceCsv(bytes.toString())[0],'generic'),key=randomBytes(32),objects=new Map<string,Buffer>();
 let attempt:DimensionedSourceAttempt|undefined,rows:PreparedDimensionedSourceRow[]=[],state='pending',fail=false;
 const input={owner:'owner',account:'account',accountCurrency:currency,bytes,filename:'synthetic.csv',mapping};
 const transport={async createAttempt(a:DimensionedSourceAttempt){attempt=a},async upload(path:string,cipher:Buffer){objects.set(path,cipher)},
  async transition(_id:string,_owner:string,from:string[],to:string){if(!from.includes(state))throw Error('Already committed');state=to},
  async register(_a:DimensionedSourceAttempt,r:PreparedDimensionedSourceRow[]){rows=r;state='linked';if(fail)throw Error('Lost response');return{import_id:'synthetic',created:true,transactions:r.length}}};
 const keys={activeId:'new',ids:['retained','new'],key(id:string){if(id!=='retained')throw Error('Missing retained key');return key}};
 const recovery={async read(_bucket:string,path:string){return objects.get(path)??null},async upload(){throw Error('Recovery must not replace original')}};
 return{input,key,transport,keys,recovery,objects,get attempt(){return attempt!},get rows(){return rows},get state(){return state},loseResponse(){fail=true}};
}
test('foreign preservation encrypts exact files/rows, retains repeated purchases and versions original-unit fingerprints',async()=>{
 for(const[currency,amount,minor,exponent]of [['USD','1.25',125,2],['EUR','1.25',125,2],['JPY','125',125,0],['KWD','10.001',10001,3]] as const){
  const f=harness(currency,amount),result=await persistDimensionedSourceCsv(f.input,f.key,'retained',f.transport);
  assert.equal(result.transactions,3);assert.equal(f.state,'linked');assert.equal(f.attempt.recovery_plan.currency_exponent,exponent);
  assert.equal(f.attempt.recovery_plan.incoming_original_minor,minor);assert.equal(f.attempt.recovery_plan.outgoing_original_minor,minor*2);
  assert.ok(f.rows.every(r=>r.signed_pence===null));assert.deepEqual(f.rows.map(r=>r.original_signed_minor),[-minor,-minor,minor]);
  assert.equal(f.rows[0].fingerprint,f.rows[1].fingerprint);assert.notEqual(f.rows[0].row_number,f.rows[1].row_number);
  assert.deepEqual(decryptSource(f.objects.get(f.attempt.object_path)!,f.key,sourceContext('owner','account',f.attempt.file_hash)),f.input.bytes);
  for(const row of f.rows){const raw=decryptSource(Buffer.from(row.raw_encrypted,'base64'),f.key,sourceContext('owner','account',f.attempt.file_hash,row.row_number));assert.equal(sourceHash(raw),row.row_hash)}
  const recovered=await verifyDimensionedSourceRecovery(f.attempt,'owner',f.keys,f.recovery);
  const deterministic=(row:PreparedDimensionedSourceRow)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='raw_encrypted'));
  assert.deepEqual(recovered.rows.map(deterministic),f.rows.map(deterministic));
  assert.equal((await verifyDimensionedSourceRecovery(f.attempt,'owner',f.keys,f.recovery)).manifest,recovered.manifest);
 }
});
test('recovery rejects changed currency/parser/ruleset/mapping/totals, wrong owner/key and damaged ciphertext',async()=>{
 const f=harness();await persistDimensionedSourceCsv(f.input,f.key,'retained',f.transport);
 for(const patch of [{account_currency:'USD'},{parser:'mapped-csv/1'},{ruleset_id:'other'},{incoming_original_minor:1},{currency_exponent:2},{mapping:{...f.input.mapping,amountMode:'card_charges'}},{private_extra:'no'}]){
  await assert.rejects(verifyDimensionedSourceRecovery({...f.attempt,recovery_plan:{...f.attempt.recovery_plan,...patch}} as DimensionedSourceAttempt,'owner',f.keys,f.recovery));
 }
 await assert.rejects(verifyDimensionedSourceRecovery(f.attempt,'other',f.keys,f.recovery));
 await assert.rejects(verifyDimensionedSourceRecovery({...f.attempt,key_id:'missing'},'owner',f.keys,f.recovery));
 const cipher=f.objects.get(f.attempt.object_path)!;cipher[cipher.length-1]^=1;
 await assert.rejects(verifyDimensionedSourceRecovery(f.attempt,'owner',f.keys,f.recovery),/authentication failed/);
});
test('uncertain registration retains the linked attempt and encrypted original for exact recovery',async()=>{
 const f=harness();f.loseResponse();await assert.rejects(persistDimensionedSourceCsv(f.input,f.key,'retained',f.transport),/Lost response/);
 assert.equal(f.state,'linked');assert.equal(f.objects.size,1);
 assert.equal((await verifyDimensionedSourceRecovery(f.attempt,'owner',f.keys,f.recovery)).rows.length,3);
});
test('invalid foreign input and GBP dispatch fail before transport writes',async()=>{
 const f=harness();await assert.rejects(persistDimensionedSourceCsv({...f.input,accountCurrency:'GBP'},f.key,'retained',f.transport));assert.equal(f.attempt,undefined);assert.equal(f.objects.size,0);
 assert.throws(()=>dimensionedSourcePlan(Buffer.alloc(1_000_001),f.input.mapping,'oversized.csv','KWD'));
 await assert.rejects(persistDimensionedSourceCsv({...f.input,accountCurrency:'JPY'},f.key,'retained',f.transport));assert.equal(f.attempt,undefined);
});
