import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {prepareSourceOriginal,type OriginalSource} from './source-original';
import {encryptSource,sourceContext,sourceHash} from './source-crypto';
test('bank originals preserve exact bytes but bind owner, account, import and file before audited text delivery',async()=>{
 const owner=randomUUID(),id=randomUUID(),account=randomUUID(),fileId=randomUUID(),key=randomBytes(32),bytes=Buffer.from('Date,Description,Amount\r\n2026-04-05,"=UNTRUSTED()",-10.001\r\n'),hash=sourceHash(bytes);
 const row:OriginalSource={id,user_id:owner,account_id:account,source_file_id:fileId,file_hash:hash,file:{id:fileId,user_id:owner,account_id:account,file_hash:hash,size_bytes:bytes.length,object_path:`${owner}/${account}/${randomUUID()}.enc`,key_id:'retained-v1'}};
 const cipher=encryptSource(bytes,key,sourceContext(owner,account,hash));let audited=0,downloads=0;const io={read:async()=>row,key:()=>Buffer.from(key),download:async()=>{downloads++;return cipher},audit:async(data:unknown)=>{audited++;assert.deepEqual(data,{user_id:owner,import_id:id,source_file_id:fileId,account_id:account,file_hash:hash,size_bytes:bytes.length,event:'download_prepared'})}};
 const result=await prepareSourceOriginal(owner,id,io);assert.deepEqual(result.bytes,bytes);assert.match(result.filename,/\.csv\.txt$/);assert.equal(result.mediaType,'application/octet-stream');assert.equal(audited,1);
 for(const changed of [{...row,user_id:randomUUID()},{...row,account_id:randomUUID()},{...row,source_file_id:randomUUID()},{...row,file:{...row.file,file_hash:'b'.repeat(64)}},{...row,file:{...row.file,object_path:`${owner}/${randomUUID()}/${randomUUID()}.enc`}},{...row,file:{...row.file,size_bytes:1000001}}])await assert.rejects(prepareSourceOriginal(owner,id,{...io,read:async()=>changed}),/Owned original/);
 assert.equal(downloads,1);await assert.rejects(prepareSourceOriginal(owner,id,{...io,key:()=>randomBytes(32)}),/authentication/);await assert.rejects(prepareSourceOriginal(owner,id,{...io,download:async()=>null}),/missing/);await assert.rejects(prepareSourceOriginal(owner,id,{...io,audit:async()=>{throw new Error('Audit unavailable')}}),/Audit unavailable/);assert.equal(audited,1);
});
