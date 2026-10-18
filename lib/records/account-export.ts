import { createHash } from 'node:crypto';
import { ACCOUNT_EXPORT_FIELDS } from './account-export-fields';
import { groupInvoiceOriginals, type InvoiceReportingRow } from '../invoices/reporting';
import { requirePence } from '../money';
import { recordEffectPence } from './accounting-effect';
import { minorPence } from './allocations';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { canonicalJson } from '../tax/snapshot';
export const ACCOUNT_EXPORT_SCHEMA = 'vibecount.partial-account/2';
export const MAX_ACCOUNT_EXPORT_BYTES = 4_000_000;
export type AccountExportKey = keyof typeof ACCOUNT_EXPORT_FIELDS;
export type AccountExportRow = Record<string, unknown> & { id: string };
export type AccountExportData = Record<AccountExportKey, AccountExportRow[]>;
export type AccountExportContext = { stamp: string; counts: Record<AccountExportKey, number> };
const decimalFields = new Set(['amount','vat_rate','tax_pot_percentage','statutory_interest_rate']);
const minorFields = new Set(['original_total_minor','net_pence','vat_pence','amount_due_pence']);
const freeText = new Set(['legal_name','name','address','contact_details','default_payment_terms','late_payment_wording','description','payment_terms']);
export function parseAccountExportContext(owner: string, value: unknown): AccountExportContext {
  const r=value as Record<string, unknown>,counts=r?.counts as Record<string,unknown>;
  if (!r || r.schema_version !== 'vibecount.partial-account-context/1' || r.owner_id !== owner || typeof r.stamp !== 'string' || r.stamp.length !== 64 || !/^[a-f0-9]{64}$/.test(r.stamp) || !counts || Object.keys(counts).length !== Object.keys(ACCOUNT_EXPORT_FIELDS).length)
    throw new Error('Complete owned account export context unavailable.');
  for (const key of Object.keys(ACCOUNT_EXPORT_FIELDS)) if (!Number.isSafeInteger(counts[key]) || (counts[key] as number)<0) throw new Error('Complete export counts unavailable.');
  if ((counts.settings as number)>1) throw new Error('Invalid settings scope.');
  return {stamp:r.stamp,counts:counts as AccountExportContext['counts']};
}
function decimal(value: string | number) {
  const pence=requirePence(value);
  if (pence<0 || pence>999999999999) throw new Error('Invalid account export amount.');
  return String(Math.floor(pence/100))+'.'+String(pence%100).padStart(2,'0');
}
export function buildAccountExport(owner: string, raw: AccountExportData, context: AccountExportContext) {
  const data={} as Record<AccountExportKey, Record<string,unknown>[]>;
  for (const key of Object.keys(ACCOUNT_EXPORT_FIELDS) as AccountExportKey[]) {
    const rows=raw[key];
    if (!Array.isArray(rows) || rows.length!==context.counts[key]) throw new Error('Incomplete account export rows.');
    const seen=new Set<string>();
    data[key]=rows.map(row=>{
      if (!row || typeof row.id!=='string' || !row.id || seen.has(row.id) || (key==='settings'?row.id:row.user_id)!==owner) throw new Error('Owned export row identity unavailable.');
      seen.add(row.id);
      const safe:Record<string,unknown>={};
      for (const field of ACCOUNT_EXPORT_FIELDS[key]) {
        const value=row[field];
        if (value===undefined || (value!==null&&!['string','number','boolean'].includes(typeof value)) || (typeof value==='number'&&!Number.isFinite(value))) throw new Error('Exact export field unavailable.');
        if (value===null) safe[field]=null;
        else if (decimalFields.has(field)) {
          if (typeof value!=='string'&&typeof value!=='number') throw new Error('Exact decimal field unavailable.');
          safe[field]=decimal(value);
        } else if (minorFields.has(field)) {
          if (typeof value!=='string'&&typeof value!=='number') throw new Error('Exact minor-unit field unavailable.');
          safe[field]=String(minorPence(value));
        } else safe[field]=freeText.has(field)&&typeof value==='string'?redactBankDetailsForPrompt(value):value;
      }
      return safe;
    });
  }
  groupInvoiceOriginals(raw.invoices as unknown as InvoiceReportingRow[]);
  const clients=new Set(raw.clients.map(r=>r.id)),invoices=new Set(raw.invoices.map(r=>r.id));
  const reference=(set:Set<string>,value:unknown,required=false)=>{
    if(value===null&&!required)return;
    if(typeof value!=='string'||!set.has(value))throw new Error('Included account relationship is incomplete.');
  };
  for(const row of raw.invoices)reference(clients,row.client_id,true);
  for(const row of raw.financialRecords){
    if((typeof row.amount!=='string'&&typeof row.amount!=='number')||![1,-1].includes(row.effect_sign as number)||!['income','expense'].includes(row.record_type as string)||!['draft','review','approved','excluded'].includes(row.status as string))throw new Error('Recognised record metadata unavailable.');
    recordEffectPence({amount:row.amount,effect_sign:row.effect_sign as number});
    reference(clients,row.client_id);reference(invoices,row.invoice_id);
  }
  for(const row of raw.invoiceReminders){reference(invoices,row.invoice_id,true);reference(clients,row.client_id,true);}
  for(const row of raw.invoiceRevisions)reference(invoices,row.invoice_id,true);
  return {
    schema_version:ACCOUNT_EXPORT_SCHEMA,
    scope:'Partial account data and invoice revision metadata only; not a restorable backup, reconciliation history or filing pack.',
    omissions:['attachments and source evidence','source facts, import rows and decision histories','settlements, credits, refunds and their histories','project and category parent tables','native PDF bytes and storage paths','generic invoice revision snapshots','provider credentials and diagnostics','bank details and UTR','reminder content and recoverable delivery attempts','encryption keys and recovery configuration'],
    presentation:'Money decimals and minor units are exact strings; null remains unknown or inapplicable. Free-text bank-number patterns are redacted; this is not a guarantee that all personal information is removed.',
    financial_record_currency:'GBP',
    financial_meaning:'Original invoice amounts are separate from cash and recognised income. Paid/delivery markers can be manual assertions. External settlement and evidence completeness are not certified.',
    owner_id:owner,counts:context.counts,data,
    data_sha256:createHash('sha256').update(canonicalJson(data),'utf8').digest('hex'),
  };
}
export function serializeAccountExport(value: ReturnType<typeof buildAccountExport>) {
  const body=JSON.stringify(value,null,2);
  if (new TextEncoder().encode(body).length>MAX_ACCOUNT_EXPORT_BYTES) throw new Error('Complete account export exceeds direct download capacity.');
  return body;
}
