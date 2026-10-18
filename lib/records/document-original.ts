import { documentContext } from './source-crypto';
import { verifiedBytes } from './evidence-recovery';
export type OriginalDocument={id:string;user_id:string;file_hash:string;media_type:string;size_bytes:number;object_path:string;key_id:string};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const extensions:Record<string,string>={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','application/zip':'zip'};
/** Server-only bytes: never embed these in agent-facing review pages or calculation snapshots. */
export async function prepareDocumentOriginal(owner:string,id:string,io:{read:()=>Promise<OriginalDocument|null>;key:(id:string)=>Uint8Array;download:(path:string)=>Promise<Uint8Array|null>;audit:(data:{user_id:string;document_id:string;file_hash:string;size_bytes:number;event:'download_prepared'})=>Promise<void>}){
 if(!uuid.test(owner)||!uuid.test(id))throw new Error('Owned document required.');
 const row=await io.read();
 if(!row||row.id!==id||row.user_id!==owner||!extensions[row.media_type]||!Number.isInteger(row.size_bytes)||row.size_bytes<1||row.size_bytes>3000000||!/^[a-f0-9]{64}$/.test(row.file_hash)||!new RegExp('^'+owner+'/[0-9a-f-]{36}/(?:0|[1-9][0-9]{0,2})\\.enc$','i').test(row.object_path))throw new Error('Owned document unavailable.');
 const key=io.key(row.key_id);let bytes:Buffer|undefined;
 try{
  bytes=verifiedBytes(await io.download(row.object_path),key,documentContext(owner,row.file_hash),row.file_hash,row.size_bytes);
  await io.audit({user_id:owner,document_id:id,file_hash:row.file_hash,size_bytes:row.size_bytes,event:'download_prepared'});
  return{bytes,mediaType:row.media_type,filename:`vibecount-document-${id}.${extensions[row.media_type]}`};
 }catch(error){bytes?.fill(0);throw error}finally{key.fill(0)}
}
