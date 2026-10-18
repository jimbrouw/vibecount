import { fxHistoryFixture } from './history-fixture';
import { FX_PROVENANCE_SCHEMA, FX_PROVENANCE_SCOPE } from './provenance';
/** Safe synthetic metadata, independently checked against actual SQL fixtures. */
export function fxProvenanceFixture() {
  const f = fxHistoryFixture(), a = f.allocation(5000), b = f.allocation(5000,5000,1250,2), z = f.allocation(1,10000,2500,3);
  const receipt = f.lot.conversion_fact.source_snapshot.receipt!;
  return { ...f, sources: [{ ...receipt, account_id: f.owner, masked_identifier: '1234', file_hash: 'c'.repeat(64), row_hash: 'd'.repeat(64), row_number: 2, in_tax_year: false }],
    raw: { schema_version: FX_PROVENANCE_SCHEMA, scope: FX_PROVENANCE_SCOPE, owner_id: f.owner,
      counts: { lots: 1, events: 3 }, lots: [{ ...f.lot, event_count: 3, active_count: 3 }], events: [a,b,z] } };
}
