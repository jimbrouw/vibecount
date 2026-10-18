import { redactBankDetailsForPrompt } from '../ai/redaction';
import { convertCurrencyMinor, currencyCode, currencyMinor, exactObject, FX_CURRENCY_RULESET, fxRate } from '../fx/currency';
import { fxEvidenceId, parseRegisteredDocumentSource } from '../fx/document-facts';
import { fxHistoryEqual } from '../fx/settlement-history';
import { sourceCsvDate } from './source-csv';

function version(v: unknown, max = 2147483647): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new Error('Review the exact valuation version.');
  return v;
}
function stamp(v: unknown) {
  if (typeof v !== 'string' || v.length !== 32 || !/^[a-f0-9]{32}$/.test(v)) throw new Error('Review the exact valuation context.');
  return v;
}
function date(v: unknown) {
  if (typeof v !== 'string' || v.length !== 10 || v !== v.trim()) throw new Error('Review an exact valuation date.');
  return sourceCsvDate(v, 'iso');
}
function reason(v: unknown) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 1000) throw new Error('Explain the valuation without private bank details.');
  const safe = redactBankDetailsForPrompt(v.trim());
  if (safe.length > 1000) throw new Error('Shorten the safe valuation reason.');
  return safe;
}
function bool(v: unknown) { if (typeof v !== 'boolean') throw new Error('Review an explicit original-read confirmation.'); return v; }
function hash(v: unknown) {
  if (typeof v !== 'string' || v.length !== 64 || !/^[a-f0-9]{64}$/.test(v)) throw new Error('Retained source hash unavailable.');
  return v;
}
export function bankValuationData(value: unknown) {
  const p = exactObject(value, ['method', 'rate', 'valuation_date', 'evidence_date']), rate = fxRate(p.rate);
  if (p.method !== 'documented_rate/1' || rate.source_currency === 'GBP' || rate.target_currency !== 'GBP')
    throw new Error('Review a documented foreign original-to-GBP rate.');
  convertCurrencyMinor(1, rate); // Same bounded normalization prerequisite as SQL.
  return { method: 'documented_rate/1' as const, rate, valuation_date: date(p.valuation_date), evidence_date: date(p.evidence_date) };
}
export function bankValuationIntent(value: unknown) {
  const p = exactObject(value, ['schema_version','ruleset_id','transaction_id','transaction_version','expected_ordinal','state','document_id','data','human_read_original','expected_stamp','rationale','request_id']);
  if (p.schema_version !== 'bank-valuation-intent/1' || p.ruleset_id !== FX_CURRENCY_RULESET ||
      typeof p.state !== 'string' || !['provisional','reviewed','withdrawn'].includes(p.state)) throw new Error('Review supported bank valuation fields.');
  const state = p.state as 'provisional' | 'reviewed' | 'withdrawn', attested = bool(p.human_read_original);
  let document_id: string | null = null, transaction_version: number | null = null, data: ReturnType<typeof bankValuationData> | null = null;
  if (state === 'withdrawn') {
    if (attested || p.document_id !== null || p.transaction_version !== null || p.data !== null) throw new Error('Withdrawal retains previous exact valuation sources.');
  } else {
    document_id = fxEvidenceId(p.document_id); transaction_version = version(p.transaction_version); data = bankValuationData(p.data);
    if (state === 'reviewed' && !attested) throw new Error('A human must review the original valuation evidence.');
  }
  return { schema_version: 'bank-valuation-intent/1' as const, ruleset_id: FX_CURRENCY_RULESET,
    transaction_id: fxEvidenceId(p.transaction_id), transaction_version, expected_ordinal: version(p.expected_ordinal, 2147483646),
    state, document_id, data, human_read_original: attested, expected_stamp: stamp(p.expected_stamp),
    rationale: reason(p.rationale), request_id: fxEvidenceId(p.request_id) };
}
export type BankValuationIntent = ReturnType<typeof bankValuationIntent>;
export function bankEconomicSource(owner: string, value: unknown) {
  const p = exactObject(value, ['schema_version','owner_id','transaction_id','account_id','account_currency','import_id','source_file_id','file_sha256','size_bytes','parser_version','source_row_id','row_number','row_sha256','cash_date','currency','original_signed_minor','ruleset_id']);
  const currency = currencyCode(p.currency), original = currencyMinor(p.original_signed_minor);
  if (p.schema_version !== 'bank-economic-source/1' || fxEvidenceId(p.owner_id) !== fxEvidenceId(owner) ||
      currency === 'GBP' || p.account_currency !== currency || !original || p.ruleset_id !== FX_CURRENCY_RULESET ||
      p.parser_version !== 'mapped-csv/2' || version(p.row_number, 5001) < 2 || version(p.size_bytes, 1000000) < 1)
    throw new Error('Complete owned dimensioned original source unavailable.');
  return { schema_version: 'bank-economic-source/1' as const, owner_id: fxEvidenceId(owner), transaction_id: fxEvidenceId(p.transaction_id),
    account_id: fxEvidenceId(p.account_id), account_currency: currency, import_id: fxEvidenceId(p.import_id), source_file_id: fxEvidenceId(p.source_file_id),
    file_sha256: hash(p.file_sha256), size_bytes: p.size_bytes as number, parser_version: 'mapped-csv/2' as const,
    source_row_id: fxEvidenceId(p.source_row_id), row_number: p.row_number as number, row_sha256: hash(p.row_sha256),
    cash_date: date(p.cash_date), currency, original_signed_minor: original, ruleset_id: FX_CURRENCY_RULESET };
}
/** Retained history only: neither parsing nor the word reviewed proves current byte access or tax eligibility. */
export function parseBankValuationRevision(owner: string, value: unknown) {
  const p = exactObject(value, ['id','user_id','family_id','ordinal','previous_revision_id','state','transaction_version','ruleset_id','document_id','data','source_snapshot','conversion','signed_gbp_pence','human_read_original','reviewed_stamp','rationale','author','request_id','created_at']);
  if (fxEvidenceId(p.user_id) !== fxEvidenceId(owner) || fxEvidenceId(p.author) !== fxEvidenceId(owner) || p.ruleset_id !== FX_CURRENCY_RULESET ||
      typeof p.state !== 'string' || !['provisional','reviewed','withdrawn'].includes(p.state) ||
      typeof p.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(p.created_at) || !Number.isFinite(Date.parse(p.created_at)))
    throw new Error('Retained valuation authorship or state unavailable.');
  const ordinal = version(p.ordinal), previous = p.previous_revision_id === null ? null : fxEvidenceId(p.previous_revision_id), attested = bool(p.human_read_original);
  if (!ordinal || (ordinal === 1) !== (previous === null) || p.state === 'reviewed' && !attested || p.state === 'withdrawn' && attested)
    throw new Error('Valuation ancestry or original-read state unavailable.');
  const raw = exactObject(p.source_snapshot, ['economic_source','document_source']), economic = bankEconomicSource(owner, raw.economic_source),
    document = parseRegisteredDocumentSource(raw.document_source), data = bankValuationData(p.data),
    conversion = convertCurrencyMinor(economic.original_signed_minor, data.rate);
  if (data.rate.source_currency !== economic.currency || document.document.id !== fxEvidenceId(p.document_id) ||
      !fxHistoryEqual(conversion, p.conversion) || currencyMinor(p.signed_gbp_pence) !== conversion.target_minor)
    throw new Error('Valuation original/source/rate/arithmetic differs.');
  return { id: fxEvidenceId(p.id), user_id: fxEvidenceId(owner), family_id: fxEvidenceId(p.family_id), ordinal,
    previous_revision_id: previous, state: p.state as 'provisional'|'reviewed'|'withdrawn', transaction_version: version(p.transaction_version),
    ruleset_id: FX_CURRENCY_RULESET, document_id: document.document.id, data, source_snapshot: {economic_source:economic,document_source:document},
    conversion, signed_gbp_pence: conversion.target_minor, human_read_original: attested, reviewed_stamp: stamp(p.reviewed_stamp),
    rationale: reason(p.rationale), author: fxEvidenceId(owner), request_id: fxEvidenceId(p.request_id), created_at: p.created_at };
}
