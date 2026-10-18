import { fxCount, fxObject, validateFxSettlementHistory } from './settlement-history';
import { minorPence } from '../records/allocations';
import { sumPence } from '../money';

export const FX_PROVENANCE_SCHEMA = 'vibecount.fx-provenance/1';
export const FX_PROVENANCE_SCOPE = 'selected_source_receipts_complete_retained_history_not_accounting_effects';
export const MAX_FX_PROVENANCE_BYTES = 2_000_000;
export const FX_PROVENANCE_LOT_COLUMNS = 'id,user_id,invoice_id,invoice_revision_id,invoice_fact_revision_id,conversion_document_id,conversion_family_id,conversion_fact_revision_id,receipt_id,receipt_version,ruleset_id,invoice_currency,cash_currency,invoice_limit_minor,cash_limit_minor,rate,conversion_date,evidence_date,invoice_snapshot,invoice_fact,conversion_fact,event_count,active_count';

/** Both SQL captures and paged source reads use this envelope. Historical facts
 * and events are context; only the existing ledger determines recognised income. */
export function parseFxProvenance(owner: string, value: unknown, sources: readonly unknown[]) {
  const p = fxObject(value), counts = fxObject(p.counts);
  if (p.schema_version !== FX_PROVENANCE_SCHEMA || p.scope !== FX_PROVENANCE_SCOPE || p.owner_id !== owner || !owner ||
      !Array.isArray(p.lots) || !Array.isArray(p.events) ||
      new TextEncoder().encode(JSON.stringify(value)).length > MAX_FX_PROVENANCE_BYTES ||
      fxCount(counts.lots) !== p.lots.length || fxCount(counts.events) !== p.events.length)
    throw new Error('Complete owned retained FX provenance unavailable.');
  const anchors = new Map(sources.map(value => { const r = fxObject(value); return [r.id, r]; }));
  if (anchors.size !== sources.length) throw new Error('Unique provenance source observations required.');
  const history = p.lots.length || p.events.length ? validateFxSettlementHistory(owner, p.lots, p.events) : { lots: [], events: [] };
  const rawLots = new Map(p.lots.map(value => { const r = fxObject(value); return [r.id, r]; }));
  const lots = history.lots.map(summary => {
    const raw = rawLots.get(summary.lot.id)!, source = anchors.get(summary.lot.receipt_id), receipt = summary.lot.conversion_fact.source_snapshot.receipt!;
    if (fxCount(raw.event_count) !== summary.version || fxCount(raw.active_count, 0, 10000) !== summary.active_count)
      throw new Error('Complete FX history does not match its authoritative event head.');
    if (!source || source.import_id !== receipt.import_id || source.source_row_id !== receipt.source_row_id ||
        source.transaction_date !== receipt.transaction_date || source.currency !== 'GBP' ||
        minorPence(source.signed_amount_pence as number | string) !== receipt.signed_amount_pence)
      throw new Error('Retained FX history belongs to another source observation.');
    return { ...summary.lot, event_count: summary.version, active_count: summary.active_count };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const events = [...history.events].sort((a, b) => a.id.localeCompare(b.id));
  const cash = new Map<string,number[]>(), original = new Map<string,number[]>(), invoiceTotals = new Map<string,number>();
  for (const summary of history.lots) {
    cash.set(summary.lot.receipt_id,[...(cash.get(summary.lot.receipt_id)??[]),summary.cash_pence]);
    original.set(summary.lot.invoice_id,[...(original.get(summary.lot.invoice_id)??[]),summary.original_minor]);
    if(summary.active_count){
      const total=summary.lot.invoice_snapshot.original_total_minor,prior=invoiceTotals.get(summary.lot.invoice_id);
      if(prior!==undefined&&prior!==total)throw new Error('Retained FX original invoice totals disagree.');
      invoiceTotals.set(summary.lot.invoice_id,total);
    }
  }
  for(const[id,values]of cash)if(sumPence(values)>minorPence(anchors.get(id)!.signed_amount_pence as number|string))throw new Error('Shared FX receipt cash capacity exceeded.');
  for(const[id,values]of original)if(sumPence(values)>(invoiceTotals.get(id)??0))throw new Error('Shared FX original invoice capacity exceeded.');
  return { schema_version: FX_PROVENANCE_SCHEMA, owner_id: owner, scope: FX_PROVENANCE_SCOPE, counts: { lots: lots.length, events: events.length }, lots, events };
}
export type FxProvenance = ReturnType<typeof parseFxProvenance>;
