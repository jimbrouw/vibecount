import { sourceContext } from './source-crypto';
import { verifiedBytes } from './evidence-recovery';
export type OriginalSource={id:string;user_id:string;account_id:string;source_file_id:string;file_hash:string;file:{id:string;user_id:string;account_id:string;file_hash:string;size_bytes:number;object_path:string;key_id:string}};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function prepareSourceOriginal(owner:string,id:string,io:{read:()=>Promise<OriginalSource|null>;key:(id:string)=>Uint8Array;download:(path:string)=>Promise<Uint8Array|null>;audit:(data:{user_id:string;import_id:string;source_file_id:string;account_id:string;file_hash:string;size_bytes:number;event:'download_prepared'})=>Promise<void>}){
 if(!uuid.test(owner)||!uuid.test(id))throw new Error('Owned import required.');
 const r=await io.read(),f=r?.file;
 if(!r||!f||r.id!==id||r.user_id!==owner||f.user_id!==owner||!uuid.test(r.account_id)||f.account_id!==r.account_id||!uuid.test(r.source_file_id)||f.id!==r.source_file_id||f.file_hash!==r.file_hash||!/^[a-f0-9]{64}$/.test(f.file_hash)||!Number.isInteger(f.size_bytes)||f.size_bytes<1||f.size_bytes>1000000||!new RegExp('^'+owner+'/'+r.account_id+'/[0-9a-f-]{36}\\.enc$','i').test(f.object_path))throw new Error('Owned original source unavailable.');
 const key=io.key(f.key_id);let bytes:Buffer|undefined;
 try{
  bytes=verifiedBytes(await io.download(f.object_path),key,sourceContext(owner,r.account_id,f.file_hash),f.file_hash,f.size_bytes);
  await io.audit({user_id:owner,import_id:id,source_file_id:f.id,account_id:r.account_id,file_hash:f.file_hash,size_bytes:f.size_bytes,event:'download_prepared'});
  // Original bytes are immutable, including potentially executable spreadsheet cells.
  // A text extension and attachment disposition avoid treating this as a sanitized ledger export.
  return{bytes,mediaType:'application/octet-stream',filename:`vibecount-original-${id}.csv.txt`};
 }catch(error){bytes?.fill(0);throw error}finally{key.fill(0)}
}
