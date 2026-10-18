import { fxEvidenceId } from './document-facts';
import { parseFxLotPortions } from './settlement-history';
export async function readFxLotPortions(db:{rpc(name:'read_fx_lot_portions',args:{p_lot:string}):PromiseLike<{data:unknown;error:unknown}>},owner:string,lot:string){
 const id=fxEvidenceId(lot),result=await db.rpc('read_fx_lot_portions',{p_lot:id});if(result.error||!result.data)throw new Error('Complete retained FX portions unavailable.');
 const parsed=parseFxLotPortions(owner,result.data);if(parsed.lot.id!==id)throw new Error('Owned retained FX lot changed.');return parsed;
}
