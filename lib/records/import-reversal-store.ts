import { importReversalDependencyReview } from '../fx/dependency-review';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
export async function readSourceImportReversal(db: Client, owner: string, source: string) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source)) throw new Error('Choose an owned import.');
    source = source.toLowerCase();
    const r = await db.rpc('read_source_import_reversal_context_v2', { p_id: source });
    if (r.error || !r.data || r.data.owner_id !== owner || r.data.import_id !== source) throw new Error('Complete owned import reversal unavailable.');
    return importReversalDependencyReview(owner, r.data);
}
