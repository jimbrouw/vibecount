import 'server-only';
import { createAdminClient } from '../supabase/admin';
import { loadEvidenceKey } from '../records/evidence-key';
import { readFxEvidenceCatalog } from './document-facts-store';
import { checkRetainedInvoiceSource, type PrivateSourceMetadata, type SourceReadIntent } from './retained-source';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
/** Caller supplies cookie-derived owner. Raw bytes and private metadata remain inside this server module. */
export async function verifyOwnedInvoiceSource(db: Client, owner: string, intent: SourceReadIntent) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Private source verification unavailable.');
  return checkRetainedInvoiceSource(owner, intent, {
    async recover(request) {
      const r = await admin.from('invoice_source_read_checks').select('*').eq('user_id', owner).eq('request_id', request).maybeSingle();
      if (r.error) throw new Error('Source check recovery unavailable.');
      return r.data;
    },
    catalog: () => readFxEvidenceCatalog(db, owner),
    async metadata(document) {
      const r = await admin.from('evidence_documents').select('id,user_id,file_hash,media_type,size_bytes,object_path,key_id').eq('user_id', owner).eq('id', document).maybeSingle();
      if (r.error || !r.data) throw new Error('Owned source unavailable.');
      return r.data as PrivateSourceMetadata;
    },
    key: id => loadEvidenceKey(id).key,
    async download(path, expectedSize) {
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 30 || expectedSize > 3000029) throw new Error('Source size unavailable.');
      const r = await admin.storage.from('document-evidence').download(path);
      if (r.error || !r.data || r.data.size !== expectedSize) throw new Error('Retained invoice object unavailable.');
      return new Uint8Array(await r.data.arrayBuffer());
    },
    async record(input, source, outcome) {
      const r = await admin.rpc('record_invoice_source_read', { p_owner: owner, p_intent: input, p_source: source, p_outcome: outcome });
      if (r.error || !r.data) throw new Error('Source check audit unavailable.');
      return r.data;
    },
  });
}
