// Containment for existing parked readers; no external currency or new agent capability.
import { invoiceOriginalAmount, isNativeReportingInvoice, type InvoiceReportingRow } from '../invoices/reporting';
import { recordEffectPence } from '../records/accounting-effect';
import { requirePence, sumPence } from '../money';
import { redactBankDetailsForPrompt } from '../ai/redaction';

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid read projection.');
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Missing read metadata.');
  return value;
}
function owned(value: unknown, owner: string) {
  const r = row(value);
  if (r.user_id !== owner || !text(r.id)) throw new Error('Invalid owned read projection.');
  return r;
}
function label(value: unknown) { return redactBankDetailsForPrompt(text(value)); }
function joinedName(value: unknown, owner: string, allowDefault = false): string | null {
  if (value === null) return null;
  const entry = Array.isArray(value) ? (value.length <= 1 ? value[0] : undefined) : value;
  if (entry === undefined && Array.isArray(value) && value.length === 0) return null;
  const joined = row(entry);
  if (joined.user_id !== owner && !(allowDefault && joined.user_id === null && joined.is_default === true)) throw new Error('Foreign related metadata.');
  return label(joined.name);
}
export function readLimit(params: URLSearchParams, fallback: number, max: number) {
  const values = params.getAll('limit');
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^[1-9]\d{0,2}$/.test(values[0])) throw new Error('Choose a valid list limit.');
  const value = Number(values[0]);
  if (value > max) throw new Error('List limit exceeds the supported bound.');
  return value;
}
export function nativeInvoiceRead(value: unknown, owner: string) {
  const r = owned(value, owner), invoice = r as InvoiceReportingRow;
  if (!['draft', 'finalised'].includes(text(r.status)) || !isNativeReportingInvoice(invoice)) throw new Error('Unsupported invoice read.');
  return { id: r.id, number: label(r.number), invoice_date: text(r.invoice_date), due_date: r.due_date === null ? null : text(r.due_date),
    amount_pence: invoiceOriginalAmount(invoice).minor, status: r.status, delivery_status: text(r.delivery_status),
    paid: r.paid_at !== null && !!text(r.paid_at), client: joinedName(r.clients, owner) };
}
export function signedRecordRead(value: unknown, owner: string, expensesOnly: boolean) {
  const r = owned(value, owner);
  if (!['income', 'expense'].includes(text(r.record_type)) || !['approved', 'review'].includes(text(r.status)) ||
      (expensesOnly && (r.record_type !== 'expense' || r.status !== 'approved')) ||
      (r.effect_sign !== 1 && r.effect_sign !== -1) || (typeof r.amount !== 'string' && typeof r.amount !== 'number')) throw new Error('Unsupported record read.');
  const common = { id: r.id, date: text(r.record_date), description: label(r.description), amount_pence: recordEffectPence({ amount: r.amount, effect_sign: r.effect_sign }) };
  return expensesOnly ? { ...common, category: joinedName(r.record_categories, owner, true) } : { id: common.id, record_type: r.record_type, date: common.date, description: common.description, amount_pence: common.amount_pence, status: r.status };
}
export function quarterReads(values: unknown[], owner: string, year: number) {
  const seen = new Set<number>();
  return values.map(value => {
    const r = row(value), quarter = r.tax_quarter;
    if (r.user_id !== owner || r.tax_year_start !== year || typeof quarter !== 'number' || ![1, 2, 3, 4].includes(quarter) || seen.has(quarter)) throw new Error('Incomplete quarter scope.');
    seen.add(quarter);
    const money = (value: unknown) => {
      if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing quarter amount.');
      return requirePence(value);
    };
    const income = money(r.income_total), expense = money(r.expense_total), net = money(r.net_total);
    if (net !== sumPence([income, -expense]) || !Number.isSafeInteger(r.income_count) || (r.income_count as number) < 0 || !Number.isSafeInteger(r.expense_count) || (r.expense_count as number) < 0) throw new Error('Invalid quarter totals.');
    return { quarter, income_pence: income, expense_pence: expense, net_profit_pence: net, record_count: sumPence([r.income_count as number, r.expense_count as number]) };
  });
}
