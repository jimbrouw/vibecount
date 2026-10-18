import { currencyCode, currencyMinor } from './currency';
import { fxEvidenceId } from './document-facts';
export const dependencyObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Complete FX dependency context unavailable.');
  return v as Record<string, unknown>;
};
function count(v: unknown, max = 20000) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw new Error('Exact FX dependency counts unavailable.');
  return v;
}
function amount(v: unknown, positive = false) {
  const n = currencyMinor(v);
  if (n < (positive ? 1 : 0)) throw new Error('Retained FX dependency amount unavailable.');
  return n;
}
/** Rebuild safe metadata; private transport properties never reach review props. */
export function parseFxDependencies(ownerValue: string, value: unknown) {
  const owner = fxEvidenceId(ownerValue), p = dependencyObject(value), c = dependencyObject(p.counts);
  if (p.schema_version !== 'fx-source-dependencies/1' || p.owner_id !== owner || typeof p.blocked !== 'boolean' || typeof p.financial_stamp !== 'string' || !/^[a-f0-9]{32}$/.test(p.financial_stamp)) throw new Error('Owned complete dependency context unavailable.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2000000 || !Array.isArray(p.sources) || p.sources.length !== count(c.sources) || !Array.isArray(p.fx_blockers) || p.fx_blockers.length !== count(c.fx_blockers, 10000)) throw new Error('Complete FX dependency counts/payload unavailable.');
  const sources = p.sources.map(v => {
    const r = dependencyObject(v), day = r.transaction_date, n = typeof day === 'string' ? Date.parse(day + 'T00:00:00Z') : NaN;
    if (r.user_id !== owner || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== day) throw new Error('Owned affected source unavailable.');
    return { id: fxEvidenceId(r.id), user_id: owner, import_id: fxEvidenceId(r.import_id), source_row_id: fxEvidenceId(r.source_row_id), transaction_date: day };
  });
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  if (sourceMap.size !== sources.length || new Set(sources.map(s => s.source_row_id)).size !== sources.length) throw new Error('Complete unique affected sources required.');
  const fx_blockers = p.fx_blockers.map(v => {
    const r = dependencyObject(v), receipt_id = fxEvidenceId(r.receipt_id), source = sourceMap.get(receipt_id), active_count = count(r.active_count, 10000), version = count(r.version, 2147483646), original_minor = amount(r.original_minor, true);
    if (r.user_id !== owner || !source || source.import_id !== r.import_id || source.source_row_id !== r.source_row_id || r.cash_currency !== 'GBP' || active_count < 1 || version < active_count || (version - active_count) % 2 || original_minor < active_count) throw new Error('Retained FX blocker/source closure unavailable.');
    return { id: fxEvidenceId(r.id), user_id: owner, invoice_id: fxEvidenceId(r.invoice_id), invoice_revision_id: fxEvidenceId(r.invoice_revision_id), receipt_id, import_id: source.import_id, source_row_id: source.source_row_id, invoice_currency: currencyCode(r.invoice_currency), original_minor, cash_currency: 'GBP' as const, cash_pence: amount(r.cash_pence), active_count, version };
  });
  if (new Set(fx_blockers.map(b => b.id)).size !== fx_blockers.length || p.blocked !== (fx_blockers.length > 0)) throw new Error('Explicit complete FX blocker state required.');
  return { schema_version: 'fx-source-dependencies/1' as const, owner_id: owner, financial_stamp: p.financial_stamp, blocked: p.blocked, counts: { sources: sources.length, fx_blockers: fx_blockers.length }, sources, fx_blockers };
}
export type FxDependencies = ReturnType<typeof parseFxDependencies>;
export function requireDependencySources(context: FxDependencies, sources: readonly { id: string; import_id?: string; source_row_id?: string; transaction_date?: string }[], stamp?: string) {
  if (stamp !== undefined && stamp !== context.financial_stamp) throw new Error('Dependency snapshot changed.');
  const byId = new Map(context.sources.map(s => [s.id, s]));
  if (byId.size !== sources.length || new Set(sources.map(s => s.id)).size !== sources.length) throw new Error('Complete selected dependency scope unavailable.');
  for (const s of sources) {
    const actual = byId.get(s.id);
    if (!actual || (s.import_id !== undefined && s.import_id !== actual.import_id) || (s.source_row_id !== undefined && s.source_row_id !== actual.source_row_id) || (s.transaction_date !== undefined && s.transaction_date !== actual.transaction_date)) throw new Error('Selected dependency source changed.');
  }
}
