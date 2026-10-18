import { parseFxEvidenceCatalog } from './document-facts';
type FxCatalogClient = { rpc: (name: string) => PromiseLike<{data:unknown;error:unknown}> };
export async function readFxEvidenceCatalog(db: FxCatalogClient, owner: string) {
    const result = await db.rpc('read_fx_evidence_catalog');
    if (result.error || result.data === null) throw new Error('Complete owned FX evidence context unavailable.');
    return parseFxEvidenceCatalog(owner,result.data);
}
