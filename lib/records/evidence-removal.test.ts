import assert from 'node:assert/strict';
import test from 'node:test';
import {removeEvidenceObject,type EvidenceRemovalWorker} from './evidence-removal';

const target={owner:'owner',request:'request',bucket:'source-evidence' as const,path:'owner/original.enc'};
function fixture(options:{admit?:boolean;removeError?:boolean;removeThrows?:boolean;absent?:boolean;verifyThrows?:boolean;record?:boolean}={}){
 const calls:{name:string;args?:Record<string,string|boolean>}[]=[];
 const worker:EvidenceRemovalWorker={
  async rpc(name,args){calls.push({name,args});return{data:name==='begin_evidence_removal'?options.admit!==false:options.record!==false,error:null}},
  async remove(bucket,path){assert.equal(bucket,target.bucket);assert.equal(path,target.path);calls.push({name:'remove'});if(options.removeThrows)throw Error('lost response');return{error:options.removeError?Error('rejected'):null}},
  async verifyAbsent(){calls.push({name:'verify'});if(options.verifyThrows)throw Error('unavailable');return options.absent!==false},
 };
 return{worker,calls};
}
test('admission precedes removal; provider absence precedes durable completion',async()=>{
 const {worker,calls}=fixture();assert.equal(await removeEvidenceObject(worker,target),'absent');
 assert.deepEqual(calls.map(c=>c.name),['begin_evidence_removal','remove','verify','record_evidence_removal_outcome']);
 assert.equal(calls[3].args!.p_attempt,calls[0].args!.p_attempt);
 assert.equal(calls[3].args!.p_provider_absent,true);
});
test('denied admission performs no removal',async()=>{
 const {worker,calls}=fixture({admit:false});await assert.rejects(removeEvidenceObject(worker,target),/not authorized/);assert.equal(calls.length,1);
});
for(const [options,expected] of [
 [{removeError:true},'failed'],[{removeThrows:true},'unknown'],[{absent:false},'unknown'],[{verifyThrows:true},'unknown'],
] as const)test(`durably retains ${JSON.stringify(options)} as ${expected}`,async()=>{
 const {worker,calls}=fixture(options);assert.equal(await removeEvidenceObject(worker,target),expected);
 assert.equal(calls.at(-1)!.args!.p_provider_absent,false);assert.equal(calls.filter(c=>c.name==='remove').length,1);
});
test('lost outcome recording does not repeat the remote operation',async()=>{
 const {worker,calls}=fixture({record:false});await assert.rejects(removeEvidenceObject(worker,target),/unresolved/);
 assert.equal(calls.filter(c=>c.name==='remove').length,1);
});
