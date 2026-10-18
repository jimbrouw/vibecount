/** Safe, versioned receipt provenance; never includes merchant text or raw evidence. */
export type ReceiptDimensions={currency:string;payment_status:'legacy'|'paid'|'unpaid';expense_kind:'expense'|'refund';payment_date:string|null;document_date:string|null;refund_of:string|null};
export function receiptCashEffect(record:{amount_pence:number;effect_sign:1|-1;status:string;receipt_dimensions?:ReceiptDimensions|null}):number|null{
 if(!Object.hasOwn(record,'receipt_dimensions'))throw new Error('Receipt cash dimensions are missing.');
 const d=record.receipt_dimensions;
 if(d!==null){
  if(!d||typeof d!=='object'||Array.isArray(d)||!Object.keys(d).every(k=>['currency','payment_status','expense_kind','payment_date','document_date','refund_of'].includes(k))
   ||typeof d.currency!=='string'||!/^[A-Z]{3}$/.test(d.currency)||!['legacy','paid','unpaid'].includes(d.payment_status)||!['expense','refund'].includes(d.expense_kind)
   ||[d.payment_date,d.document_date,d.refund_of].some(v=>v!==null&&typeof v!=='string'))throw new Error('Invalid receipt cash dimensions.');
 }
 if(!Number.isSafeInteger(record.amount_pence)||record.amount_pence<0||![1,-1].includes(record.effect_sign))throw new Error('Invalid receipt ledger effect.');
 if(record.status!=='approved'||d&&(d.currency!=='GBP'||d.payment_status==='unpaid'))return null;
 return record.amount_pence*(d?.expense_kind==='refund'?-1:record.effect_sign);
}
