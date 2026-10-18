import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { sourceGroups, scopedSourceRows } from './source-groups.ts';
import { readSourceCsv, suggestMapping } from './source-csv.ts';
import { sourcePlan, persistSourceCsv, type SourceAttempt } from './source-persistence.ts';
import { sourceHash, sourceContext, decryptSource } from './source-crypto.ts';
import { verifySourceRecovery } from './evidence-recovery.ts';
import { parseEvidenceKeyring } from './evidence-keyring.ts';
const bytes=Buffer.from('Account,Date,Description,Outflow_GBP,Claim_status\nStarling,2025-04-06,Synthetic one,10.01,Claim\nAmex,2025-04-07,Synthetic two,20.02,Claim\nNationwide,2025-04-08,Synthetic three,30.03,Claim\nStarling,2025-04-09,Synthetic refund,-1.00,Claim');
function fixture() { const table=readSourceCsv(bytes.toString());const mapping=suggestMapping(table[0],'generic');mapping.dateFormat='iso';return {table,mapping}; }

test('groups partition every observation exactly once, preserve original row numbers and money direction',()=>{
  const {table,mapping}=fixture();const groups=sourceGroups(table,mapping);
  assert.deepEqual(groups.map(g=>[g.scope.value,g.rows.length,g.outgoing,g.incoming]),[['Starling',2,1001,100],['Amex',1,2002,0],['Nationwide',1,3003,0]]);
  assert.deepEqual(groups.flatMap(g=>g.rows.map(r=>r.rowNumber)).sort(),[2,3,4,5]);
  assert.deepEqual(scopedSourceRows(table,{...mapping,accountScope:groups[0].scope}).map(r=>r.rowNumber),[2,5]);
  assert.throws(()=>scopedSourceRows(table,{...mapping,accountScope:{column:1,value:'Starling'}}));
  assert.throws(()=>scopedSourceRows(table,{...mapping,accountScope:{column:0,value:'Unknown'}}));
  assert.throws(()=>sourceGroups(readSourceCsv(bytes.toString().replace('Amex,2025',',2025')),mapping),/account label/);
});

test('grouped evidence retains exact full original, canonical scope and recoverable original row identities',async()=>{
  const {table,mapping}=fixture();const scope=sourceGroups(table,mapping)[0].scope;
  const key=randomBytes(32),owner=randomUUID(),account=randomUUID();
  let attempt:SourceAttempt|undefined; const objects=new Map<string,Buffer>();
  await persistSourceCsv({owner,account,bytes,filename:'synthetic-combined.csv',mapping:{...mapping,accountScope:scope}},key,'v1',{
    async createAttempt(a){attempt=a;}, async upload(path,b){objects.set(path,b);},async transition(){},
    async register(a,rows){assert.deepEqual(rows.map(r=>r.row_number),[2,5]);return {import_id:randomUUID(),created:true,transactions:rows.length};},
  });
  assert.ok(attempt);assert.equal(attempt.file_hash,sourceHash(bytes));assert.equal(attempt.recovery_plan.parser,'grouped-csv/1');
  assert.deepEqual(attempt.recovery_plan.mapping.accountScope,scope);
  assert.deepEqual(decryptSource(objects.get(attempt.object_path)!,key,sourceContext(owner,account,attempt.file_hash)),bytes);
  const keys=parseEvidenceKeyring({VIBECOUNT_SOURCE_ENCRYPTION_KEY:key.toString('base64')});
  const transport={async read(_bucket:string,path:string){return objects.get(path)!;},async exists(){return true;},async upload(){throw new Error("Recovery verification must not write");}};
  const recovered=await verifySourceRecovery(attempt,owner,keys,transport);
  assert.deepEqual(recovered.rows.map(r=>r.row_number),[2,5]);
  await assert.rejects(verifySourceRecovery(attempt,randomUUID(),keys,transport),/Owned evidence/);
  const changed=structuredClone(attempt);changed.recovery_plan.mapping.accountScope!.value='Amex';
  await assert.rejects(verifySourceRecovery(changed,owner,keys,transport),/confirmed mapping/);
});

test('unscoped historic source plans keep their original parser and mapping shape',()=>{
  const {mapping}=fixture();const plan=sourcePlan(bytes,mapping,'synthetic.csv').plan;
  assert.equal(plan.parser,'mapped-csv/1');assert.equal('accountScope' in plan.mapping,false);assert.equal(plan.row_count,4);
});
