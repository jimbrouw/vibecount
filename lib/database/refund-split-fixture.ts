import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

/** Real authenticated approval for synthetic disposable database fixtures. */
export async function syntheticRefundSplit(db: PGlite, refund: string, portions: [string, number][], reason = 'Reviewed synthetic split evidence') {
    const intent = {
        schema_version: 'refund-split-intent/1', refund_id: refund,
        refund_version: (await db.query<{ v: number }>('select decision_version v from bank_transactions where id=$1', [refund])).rows[0].v,
        expected_stamp: (await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s,
        allocations: await Promise.all(portions.map(async ([original_id, amount_pence]) => ({ original_id, amount_pence,
            original_version: (await db.query<{ v: number }>('select decision_version v from bank_transactions where id=$1', [original_id])).rows[0].v,
            refund_stamp: (await db.query<{ s: string }>('select refund_group_stamp($1) s', [original_id])).rows[0].s,
        }))), rationale: reason, request_id: randomUUID(),
    };
    const result = (await db.query<{ r: { observed_cash_pence: number; recognized_reduction_pence: number; portions: { original_id: string; refund_link_id: string; record_id: string | null; recognized_pence: number }[] } }>('select approve_refund_split($1) r', [JSON.stringify(intent)])).rows[0].r;
    return { intent, result };
}
