import 'server-only';
import { createAdminClient } from '../supabase/admin';
import { loadEvidenceKey } from './evidence-key';
import { prepareDocumentOriginal } from './document-original';
/** Called only after authenticated, same-origin, explicit download confirmation. */
export async function readDocumentOriginal(owner:string,id:string){
 const admin=createAdminClient();if(!admin)throw new Error('Evidence service unavailable.');
 return prepareDocumentOriginal(owner,id,{
  async read(){const available=await admin.rpc('evidence_original_available',{p_owner:owner,p_kind:'document',p_id:id});if(available.error||available.data!==true)throw new Error('Original evidence unavailable.');const r=await admin.from('evidence_documents').select('id,user_id,file_hash,media_type,size_bytes,object_path,key_id').eq('id',id).eq('user_id',owner).maybeSingle();if(r.error)throw new Error('Evidence unavailable.');return r.data},
  key:id=>loadEvidenceKey(id).key,
  async download(path){const r=await admin.storage.from('document-evidence').download(path);if(r.error||!r.data)throw new Error('Evidence unavailable.');if(r.data.size>3000029)throw new Error('Evidence exceeds capacity.');return new Uint8Array(await r.data.arrayBuffer())},
  async audit(data){const r=await admin.from('document_original_access').insert(data);if(r.error)throw new Error('Evidence access could not be recorded.')}
 });
}
