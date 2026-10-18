import 'server-only';
import { createAdminClient } from '../supabase/admin';
import { loadEvidenceKey } from '../records/evidence-key';
import type { PrivateSourceMetadata } from './retained-source';
import { readFxSettlementCatalog } from './settlement-catalog-store';
import { checkSettlementSources } from './settlement-source';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
/** Owner comes from cookie authentication. No service financial writes occur. */
export async function verifyOwnedSettlementSources(db: Client, owner: string, intent: unknown) {
  const admin = createAdminClient();
  if (!admin) throw new Error('Private settlement source verification unavailable.');
  return checkSettlementSources(owner, intent, {
    async recover(request) {
      const r = await admin.from('fx_settlement_source_checks').select('*').eq('user_id', owner).eq('request_id', request).maybeSingle();
      if (r.error) throw new Error('Settlement source-check recovery unavailable.');
      return r.data;
    },
    catalog: () => readFxSettlementCatalog(db, owner),
    async metadata(document) {
      const r = await admin.from('evidence_documents').select('id,user_id,file_hash,media_type,size_bytes,object_path,key_id').eq('user_id', owner).eq('id', document).maybeSingle();
      if (r.error || !r.data) throw new Error('Owned settlement evidence unavailable.');
      return r.data as PrivateSourceMetadata;
    },
    key: id => loadEvidenceKey(id).key,
    async download(path, expectedSize) {
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 30 || expectedSize > 3000029) throw new Error('Bounded settlement object unavailable.');
      const r = await admin.storage.from('document-evidence').download(path);
      if (r.error || !r.data || r.data.size !== expectedSize) throw new Error('Retained settlement object unavailable.');
      return new Uint8Array(await r.data.arrayBuffer());
    },
    async record(input, sources, outcome) {
      const r = await admin.rpc('record_fx_settlement_source_check', { p_owner: owner, p_intent: input, p_sources: sources, p_outcome: outcome });
      if (r.error || !r.data) throw new Error('Settlement source audit unavailable.');
      return r.data;
    },
  });
}
