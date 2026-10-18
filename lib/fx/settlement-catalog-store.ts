import { parseFxSettlementCatalog } from './settlement-catalog';
/** Caller uses the signed-in cookie client; owner is checked again in the safe parser. */
export async function readFxSettlementCatalog(db: {
    rpc(name: 'read_fx_settlement_catalog'): PromiseLike<{ data: unknown; error: unknown }>;
}, owner: string) {
    const result = await db.rpc('read_fx_settlement_catalog');
    if (result.error || !result.data) throw new Error('Complete FX settlement review unavailable.');
    return parseFxSettlementCatalog(owner, result.data);
}
