import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllExportRows } from './export-pages';
import { FX_EVENT_COLUMNS } from '../fx/settlement-history';
import { FX_PROVENANCE_LOT_COLUMNS, FX_PROVENANCE_SCHEMA, FX_PROVENANCE_SCOPE, parseFxProvenance } from '../fx/provenance';

/** Caller brackets this complete read with the same financial stamp as sources. */
export async function readSourceFxProvenance(db: SupabaseClient, owner: string, sources: { id: string; [key: string]: unknown }[]) {
  if (new Set(sources.map(r => r.id)).size !== sources.length) throw new Error('Unique source observations required.');
  const lots: ({ id: string; [key: string]: unknown })[] = [], events: ({ id: string; [key: string]: unknown })[] = [];
  const batches = async (ids: string[], table: string, key: string, columns: string, into: typeof lots) => {
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100);
      into.push(...await readAllExportRows<{ id: string; [key: string]: unknown }>(async after => {
        let q = db.from(table).select(columns).eq('user_id', owner).in(key, batch).order('id').limit(500);
        if (table === 'invoice_settlements') q = q.eq('settlement_kind','fx_gbp_cash');
        if (after) q = q.gt('id', after);
        const r = await q; return { data: r.data as unknown as typeof lots | null, error: r.error };
      }));
    }
  };
  await batches(sources.map(r => r.id), 'fx_provenance_lot_sources', 'receipt_id', FX_PROVENANCE_LOT_COLUMNS, lots);
  // Independently source-select events: an omitted lot cannot hide its history.
  // Every immutable event in a lot has the same receipt, including reversals.
  await batches(sources.map(r => r.id), 'invoice_settlements', 'transaction_id', FX_EVENT_COLUMNS, events);
  return parseFxProvenance(owner, { schema_version: FX_PROVENANCE_SCHEMA, owner_id: owner, scope: FX_PROVENANCE_SCOPE,
    counts: { lots: lots.length, events: events.length }, lots, events }, sources);
}
