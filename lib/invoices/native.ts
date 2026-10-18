import { decimalToPence } from '../money';
export const NATIVE_INVOICE_ORIGIN='native_gbp';
export type NativeGbpInvoice={origin:typeof NATIVE_INVOICE_ORIGIN;currency:'GBP';amount:string|number};
/** Missing units/origin or null amount cannot enter native GBP document/delivery code. */
export function isNativeGbpInvoice<T>(value:T):value is T & NativeGbpInvoice {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const row=value as Record<string,unknown>;
    if(row.origin!==NATIVE_INVOICE_ORIGIN||row.currency!=='GBP'||(typeof row.amount!=='string'&&typeof row.amount!=='number'))return false;
    if(String(row.amount).length>32)return false;
    const pence=decimalToPence(row.amount);
    return pence!==null&&pence>=0&&pence<=999999999999;
}
export function requireNativeGbpInvoice<T>(value:T):asserts value is T & NativeGbpInvoice {
    if(!isNativeGbpInvoice(value))throw new Error('Use the preserved invoice evidence workflow. Native invoice actions require explicit GBP amounts and native origin.');
}
