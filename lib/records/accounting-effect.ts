import { requirePence } from "../money";

export type AccountingAmount = {
  amount: string | number;
  effect_sign?: number;
  cash_effect_pence?: number|string|null;
  cash_treatment?: "recognized"|"unpaid"|"unsupported_currency"|"not_approved";
};
/** Positive magnitude is retained as evidence; sign identifies its accounting effect. */
export function recordEffectPence(record: AccountingAmount) {
  if(Object.hasOwn(record,'cash_effect_pence')){
    const treatment=record.cash_treatment;
    if(!['recognized','unpaid','unsupported_currency','not_approved'].includes(treatment??''))throw new Error('Missing cash treatment.');
    if(record.cash_effect_pence===null){
      if(treatment==='recognized')throw new Error('Missing recognized cash effect.');
      return 0;
    }
    const raw=record.cash_effect_pence;
    if(treatment!=='recognized'||!(/^-?\d+$/.test(String(raw))))throw new Error('Invalid cash effect.');
    const value=Number(raw);
    if(!Number.isSafeInteger(value))throw new Error('Invalid cash effect.');
    return value;
  }
  if(record.cash_treatment!==undefined)throw new Error('Missing cash effect.');
  const magnitude = requirePence(record.amount);
  const sign = record.effect_sign === undefined ? 1 : record.effect_sign;
  if (magnitude < 0 || (sign !== 1 && sign !== -1))
    throw new Error("Invalid accounting effect.");
  return magnitude * sign;
}
export function recordEffectDecimal(record: AccountingAmount) {
  const pence = recordEffectPence(record),
    magnitude = Math.abs(pence);
  return `${pence < 0 ? "-" : ""}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}

export function recordCashNote(record:AccountingAmount):string|null{
  switch(record.cash_treatment){
    case 'unpaid':return 'Unpaid — excluded from cash totals';
    case 'unsupported_currency':return 'Unsupported currency — excluded from GBP cash totals';
    case 'not_approved':return 'Not approved — excluded from cash totals';
    default:return null;
  }
}
