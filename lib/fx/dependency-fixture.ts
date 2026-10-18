import { importReversalFixture } from '../records/import-reversal-fixture';
import { fxFixtureId as id } from './fixture';
export function importDependencyFixture(blocked=false){
 const native=importReversalFixture(),sources=native.transactions.map(t=>({id:t.id,user_id:t.user_id,import_id:t.import_id,source_row_id:t.source_row_id,transaction_date:t.transaction_date})),source=sources.find(s=>s.id===id(123))!;
 return{schema_version:'source-import-reversal-context/2',owner_id:native.owner_id,import_id:native.import_id,import_status:native.import_status,financial_stamp:native.financial_stamp,blocked,counts:{sources:sources.length,fx_blockers:blocked?1:0},sources,
  fx_blockers:blocked?[{id:id(960),user_id:native.owner_id,invoice_id:id(961),invoice_revision_id:id(962),receipt_id:source.id,import_id:source.import_id,source_row_id:source.source_row_id,invoice_currency:'KWD',original_minor:1,cash_currency:'GBP',cash_pence:0,active_count:1,version:1}]:[],native_context:blocked?null:native};
}
/** Synthetic safe sources; blocker identities are deliberately unrelated to real accounts. */
export function sourceDependenciesFixture(owner: string, stamp: string, sources: { id: string; user_id?: string; import_id: string; source_row_id: string; transaction_date?: string }[], blockedIds: string[] = []) {
 const rows = sources.map(s => ({ id: s.id, user_id: owner, import_id: s.import_id, source_row_id: s.source_row_id, transaction_date: s.transaction_date ?? '2026-04-06' }));
 const blockers = rows.filter(s => blockedIds.includes(s.id)).map((s, i) => ({ id: `00000000-0000-4000-8000-${String(960 + i).padStart(12, '0')}`, user_id: owner,
  invoice_id: '00000000-0000-4000-8000-000000000961', invoice_revision_id: '00000000-0000-4000-8000-000000000962', receipt_id: s.id, import_id: s.import_id, source_row_id: s.source_row_id,
  invoice_currency: 'KWD', original_minor: 1, cash_currency: 'GBP', cash_pence: 0, active_count: 1, version: 1 }));
 return { schema_version: 'fx-source-dependencies/1', owner_id: owner, financial_stamp: stamp, blocked: blockers.length > 0, counts: { sources: rows.length, fx_blockers: blockers.length }, sources: rows, fx_blockers: blockers };
}
