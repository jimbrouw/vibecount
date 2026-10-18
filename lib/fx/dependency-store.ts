import { dependencyObject, parseFxDependencies, requireDependencySources } from './dependencies';
import { fxEvidenceId } from './document-facts';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
export async function readFxSourceDependencies(db: Client, owner: string, nodes: string[]) {
  const ids = nodes.map(fxEvidenceId);
  if (!ids.length || ids.length > 101 || new Set(ids).size !== ids.length) throw new Error('Choose distinct owned endpoints.');
  const r = await db.rpc('read_fx_source_dependencies', { p_nodes: ids });
  if (r.error) throw new Error('Complete source dependencies unavailable.');
  const context = parseFxDependencies(owner, r.data);
  requireDependencySources(context, ids.map(id => ({ id })));
  return context;
}
export async function readAssignmentFxDependencies(db: Client, owner: string, allocation: string) {
  const id = fxEvidenceId(allocation), r = await db.rpc('read_refund_assignment_fx_context', { p_allocation: id });
  if (r.error) throw new Error('Complete assignment dependencies unavailable.');
  const p = dependencyObject(r.data);
  if (p.schema_version !== 'refund-assignment-context/1' || p.allocation_id !== id) throw new Error('Selected assignment dependency changed.');
  const context = parseFxDependencies(owner, p.dependencies);
  if (context.sources.length !== 1) throw new Error('Complete original receipt dependencies unavailable.');
  return context;
}
