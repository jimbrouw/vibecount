import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {prepareDocumentOriginal,type OriginalDocument} from './document-original';
import {encryptSource,documentContext,sourceHash} from './source-crypto';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';

test('retained originals use recorded keys, exact owned context, size/hash verification and audit before delivery',async()=>{
 const owner=randomUUID(),id=randomUUID(),bytes=await readFile(new URL('../../fixtures/document-evidence/invoice-one.pdf',import.meta.url)),key=randomBytes(32),hash=sourceHash(bytes);
 const row:OriginalDocument={id,user_id:owner,file_hash:hash,media_type:'application/pdf',size_bytes:bytes.length,object_path:`${owner}/${randomUUID()}/0.enc`,key_id:'retained-v1'},cipher=encryptSource(bytes,key,documentContext(owner,hash));
 let audit=0,downloads=0,chosen='';let returnedKey:Uint8Array;
 const io={read:async()=>row,key:(id:string)=>{chosen=id;return returnedKey=Buffer.from(key)},download:async()=>{downloads++;return cipher},audit:async()=>{audit++}};
 const result=await prepareDocumentOriginal(owner,id,io);assert.deepEqual(result.bytes,bytes);assert.equal((await PDFDocument.load(result.bytes)).getPageCount(),1);assert.equal(chosen,'retained-v1');assert.equal(audit,1);assert.ok(returnedKey!.every(n=>n===0));assert.equal(result.filename,`vibecount-document-${id}.pdf`);
 await assert.rejects(prepareDocumentOriginal(randomUUID(),id,io),/Owned document/);assert.equal(downloads,1);
 for(const change of [{file_hash:'a'.repeat(64)},{size_bytes:bytes.length+1},{object_path:`${randomUUID()}/${randomUUID()}/0.enc`},{media_type:'text/html'}])await assert.rejects(prepareDocumentOriginal(owner,id,{...io,read:async()=>({...row,...change})}));
 await assert.rejects(prepareDocumentOriginal(owner,id,{...io,key:()=>randomBytes(32)}),/authentication/);
 const bad=Buffer.from(cipher);bad[bad.length-1]^=1;await assert.rejects(prepareDocumentOriginal(owner,id,{...io,download:async()=>bad}),/authentication/);
 await assert.rejects(prepareDocumentOriginal(owner,id,{...io,download:async()=>null}),/missing/);
 await assert.rejects(prepareDocumentOriginal(owner,id,{...io,audit:async()=>{throw new Error('Audit unavailable')}}),/Audit unavailable/);assert.equal(audit,1);
});

for(const kind of ['document','source'] as const)test(kind+' original download requires authenticated same-origin explicit confirmation and returns private attachment bytes only',async()=>{
 const owner=randomUUID(),id=randomUUID();
 const built=await build({absWorkingDir:process.cwd(),bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:process.cwd(),contents:`export {POST} from '${kind==='document'?'./app/api/evidence/documents/[documentId]/original/route':'./app/api/imports/[importId]/original/route'}';export {state} from 'test:original';`},plugins:[{name:'original-fixture',setup(b){b.onResolve({filter:/^(test:original|@\/lib\/supabase\/server|@\/lib\/records\/(?:document|source)-original-store)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const state={signedIn:true,calls:[],fail:false};export async function createClient(){return {auth:{getUser:async()=>({data:{user:state.signedIn?{id:'${owner}'}:null},error:null})}}};export async function readDocumentOriginal(owner,id){state.calls.push({owner,id});if(state.fail)throw Error('PRIVATE KEY PATH');return {bytes:Buffer.from('private original'),mediaType:'application/pdf',filename:'safe.pdf'}};export const readSourceOriginal=readDocumentOriginal;`}))}}]});
 const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const call=(body='humanConfirmed=yes',origin='http://localhost',documentId:string=id)=>m.POST(new Request('http://localhost/api/evidence/documents/'+documentId+'/original',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body}),{params:Promise.resolve(kind==='document'?{documentId}:{importId:documentId})});
 m.state.signedIn=false;assert.equal((await call()).status,401);m.state.signedIn=true;
 assert.equal((await call('humanConfirmed=yes','https://foreign.example')).status,403);assert.equal((await call('')).status,400);assert.equal((await call('humanConfirmed=yes&humanConfirmed=yes')).status,400);assert.equal((await call('x'.repeat(129))).status,400);assert.equal((await call('humanConfirmed=yes','http://localhost','bad')).status,400);assert.equal(m.state.calls.length,0);
 const response=await call();assert.equal(response.status,200);assert.equal(await response.text(),'private original');assert.match(response.headers.get('content-disposition'),/^attachment/);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(m.state.calls,[{owner,id}]);
 m.state.fail=true;const failed=await call();assert.equal(failed.status,404);assert.doesNotMatch(await failed.text(),/PRIVATE KEY PATH/);
});
