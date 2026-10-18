import type { PGlite } from '@electric-sql/pglite';
import { evidenceManifestV3 } from '../records/evidence-manifest-v3';

/** Explicit safe SQL projections for a disposable fixture; never a live store. */
export async function readFxSourceManifestFixture(db: PGlite, owner: string, receipt: string) {
  await db.exec('reset role');
  const meta=(await db.query<{r:Parameters<typeof evidenceManifestV3>[1]}>('select to_jsonb(v) r from (select i.id,i.file_hash,i.parser_version,i.account_id,i.status,i.created_at,i.coverage_start,i.coverage_end from record_imports i join bank_transactions t on t.import_id=i.id and t.user_id=i.user_id where t.id=$1 and t.user_id=$2) v',[receipt,owner])).rows[0].r;
  const account=(await db.query<Parameters<typeof evidenceManifestV3>[2]>('select label,masked_identifier from financial_accounts where id=$1 and user_id=$2',[meta.account_id,owner])).rows[0];
  const rows=(await db.query<{r:Parameters<typeof evidenceManifestV3>[3][number]}>(`select to_jsonb(v) r from (
    select t.id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,t.classification,t.business_use_bps,t.dedupe_status,t.decision_version,
    t.active_transfer_id,t.active_refund_id,t.active_duplicate_decision_id,t.source_row_id,t.tax_year_start,
    jsonb_build_object('row_number',s.row_number,'row_hash',s.row_hash) source_rows,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'amount',f.amount::text,'status',f.status,'record_type',f.record_type,'effect_sign',f.effect_sign,'refund_link_id',f.refund_link_id,'bank_transaction_id',f.bank_transaction_id)) from financial_records f where f.bank_transaction_id=t.id and f.user_id=t.user_id),'[]'::jsonb) record
    from bank_transactions t join source_rows s on s.id=t.source_row_id and s.user_id=t.user_id where t.import_id=$1 and t.user_id=$2 order by t.id) v`,[meta.id,owner])).rows.map(v=>v.r);
  const provenance=(await db.query<{r:unknown}>('select fx_provenance_for_owner($1,$2) r',[owner,rows.map(r=>r.id)])).rows[0].r;
  return evidenceManifestV3(owner,meta,account,rows,provenance);
}
