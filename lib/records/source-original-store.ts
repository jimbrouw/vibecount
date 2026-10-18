import 'server-only';
import { createAdminClient } from '../supabase/admin';
import { loadEvidenceKey } from './evidence-key';
import { prepareSourceOriginal } from './source-original';
export async function readSourceOriginal(owner:string,id:string){
 const admin=createAdminClient();if(!admin)throw new Error('Evidence service unavailable.');
 return prepareSourceOriginal(owner,id,{
  async read(){const available=await admin.rpc('evidence_original_available',{p_owner:owner,p_kind:'source',p_id:id});if(available.error||available.data!==true)throw new Error('Original evidence unavailable.');
   const r=await admin.from('record_imports').select('id,user_id,account_id,source_file_id,file_hash').eq('id',id).eq('user_id',owner).maybeSingle();if(r.error||!r.data?.source_file_id)throw new Error('Original source unavailable.');
   const file=await admin.from('record_source_files').select('id,user_id,account_id,file_hash,size_bytes,object_path,key_id').eq('id',r.data.source_file_id).eq('user_id',owner).maybeSingle();if(file.error||!file.data)throw new Error('Original source unavailable.');return{...r.data,file:file.data};
  },
  key:id=>loadEvidenceKey(id).key,
  async download(path){const r=await admin.storage.from('source-evidence').download(path);if(r.error||!r.data||r.data.size>1000029)throw new Error('Original source unavailable.');return new Uint8Array(await r.data.arrayBuffer())},
  async audit(data){const r=await admin.from('source_original_access').insert(data);if(r.error)throw new Error('Evidence access could not be recorded.')}
 });
}
