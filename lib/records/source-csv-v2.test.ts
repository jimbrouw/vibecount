import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseDimensionedSourceCsv } from './source-csv-v2';
import { normalizeSourceCsv, readSourceCsv, suggestMapping } from './source-csv';

function parse(text: string, currency: string, provider = 'generic') {
  return parseDimensionedSourceCsv(text, suggestMapping(readSourceCsv(text)[0], provider), currency);
}

test('dimensioned parser preserves complete native V1 output and does not change its parser contract', async () => {
  const fixture = await readFile(new URL('../../fixtures/synthetic-starling.csv', import.meta.url), 'utf8');
  for (const [text, provider] of [[fixture, 'starling'],
    ['Date,Description,Paid Out,Paid In\n05/04/2026,Purchase,630.29,\n06/04/2026,Receipt,,1500', 'nationwide'],
    ['Date,Description,Amount\n01/02/2026,Card purchase,12.50\n02/02/2026,Card repayment,-100', 'amex']]) {
    const table = readSourceCsv(text), mapping = suggestMapping(table[0], provider), legacy = normalizeSourceCsv(table, mapping);
    const result = parseDimensionedSourceCsv(text, mapping, 'GBP');
    assert.equal(result.parser_version, 'mapped-csv/2');
    assert.equal(result.currency_ruleset, 'vibecount-currencies/1');
    assert.deepEqual(result.rows.map(r => ({ rowNumber: r.rowNumber, date: r.date, description: r.description,
      signedPence: r.signedAmountPence, currency: r.currency, reference: r.reference, rawCells: r.rawCells })), legacy);
    assert.deepEqual(result.rows.map(r => r.signedOriginalMinor), legacy.map(r => r.signedPence));
    assert.ok(result.rows.every(r => r.currencyExponent === 2));
  }
});

test('foreign original units retain exact exponent and sign without fabricating GBP value', () => {
  for (const [currency, amount, expected, exponent] of [
    ['USD', '-1,250.29', -125029, 2], ['EUR', '1.05', 105, 2],
    ['JPY', '-2501', -2501, 0], ['KWD', '10.001', 10001, 3],
  ] as const) {
    const text = `Date,Description,Amount,Currency,Reference\r\n05/04/2026,Source,"${amount}",${currency.toLowerCase()},Ref 1`;
    const result = parse(text, currency), row = result.rows[0];
    assert.equal(result.account_currency, currency); assert.equal(row.currency, currency);
    assert.equal(row.signedOriginalMinor, expected); assert.equal(row.currencyExponent, exponent);
    assert.equal(row.signedAmountPence, null); assert.equal(row.rawCells[2], amount);
    assert.equal(row.date, '2026-04-05'); assert.equal(row.reference, 'Ref 1');
  }
});

test('synthetic foreign fixtures retain all original observations and never imply GBP recognition', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../../fixtures/synthetic-foreign-sources.json', import.meta.url), 'utf8')) as
    { currency: string; provider: string; csv: string }[];
  const results = fixtures.map(f => parse(f.csv, f.currency, f.provider));
  assert.deepEqual(results.map(r => r.rows.map(row => row.signedOriginalMinor)),
    [[150001, -1250, -1250], [-63029, 70000], [2501, -1250], [10001, -1]]);
  assert.ok(results.every(r => r.rows.every(row => row.signedAmountPence === null)));
  assert.deepEqual(results[0].rows.slice(1).map(row => row.rowNumber), [3, 4]);
});

test('debit/credit and card charge conventions preserve foreign cash direction and source rows', () => {
  const text = 'Date,Description,Paid Out,Paid In,Currency\n05/04/2026,Purchase,10.001,,KWD\n\n06/04/2026,Receipt,,5.002,KWD';
  const rows = parse(text, 'KWD', 'nationwide').rows;
  assert.deepEqual(rows.map(r => [r.rowNumber, r.date, r.signedOriginalMinor]),
    [[2, '2026-04-05', -10001], [4, '2026-04-06', 5002]]);
  const card = parse('Date,Description,Amount\n01/02/2026,Purchase,1200\n02/02/2026,Repayment,-1000', 'JPY', 'amex');
  assert.deepEqual(card.rows.map(r => r.signedOriginalMinor), [-1200, 1000]);
  for (const amounts of ['-1,0', '1,1', '0,0'])
    assert.throws(() => parse(`Date,Description,Paid Out,Paid In\n01/02/2026,Item,${amounts}`, 'JPY', 'nationwide'), /Row 2/);
});

test('explicit account currency, row parity and selected column declarations prevent currency confusion', () => {
  const text = 'Date,Description,Amount,Currency\n01/02/2026,Item,1.00,USD\n02/02/2026,Other,1.00,EUR';
  assert.throws(() => parse(text, 'USD'), /Row 3.*match/);
  for (const c of ['', 'usd', 'AUD', null, ['USD']]) {
    const simple = 'Date,Description,Amount\n01/02/2026,Item,1';
    assert.throws(() => parseDimensionedSourceCsv(simple, suggestMapping(readSourceCsv(simple)[0], 'generic'), c));
  }
  for (const header of ['Amount (GBP)', 'Amount [JPY]', 'Amount in EUR', 'Amount AUD', 'Debit USD / GBP',
    'EUR Amount', 'debit kwd', 'Amount_CHF', 'Amount ($)']) {
    const t = `Date,Description,${header}\n01/02/2026,Item,1`;
    const m = { ...suggestMapping(readSourceCsv(t)[0], 'generic'), amount: 2 };
    assert.throws(() => parseDimensionedSourceCsv(t, m, 'USD'), /currency/);
  }
  const t = 'Date,Description,Amount (USD),Balance (GBP)\n01/02/2026,Item,1.25,42.00';
  const m = { ...suggestMapping(readSourceCsv(t)[0], 'generic'), amount: 2 };
  assert.equal(parseDimensionedSourceCsv(t, m, 'USD').rows[0].signedOriginalMinor, 125);
  for (const symbol of ['€', '$', '¥', '₹', '£€']) {
    const t = `Date,Description,Amount (${symbol})\n01/02/2026,Item,1`;
    assert.throws(() => parseDimensionedSourceCsv(t, { ...m, amount: 2 }, 'GBP'), /currency/);
  }
  const pounds = 'Date,Description,Amount (£)\n01/02/2026,Item,£1.25';
  assert.equal(parseDimensionedSourceCsv(pounds, m, 'GBP').rows[0].signedAmountPence, 125);
  const native = 'Date,Description,Amount (GBP),Balance (USD)\n01/02/2026,Item,1.25,42.00';
  // Preserve the V1 native guard rather than weakening old normalization during this prerequisite.
  assert.throws(() => parseDimensionedSourceCsv(native, m, 'GBP'), /GBP amounts/);
});

test('precision, grouping, ambiguity, zero and bounded amounts are checked before any valuation', () => {
  for (const [currency, amounts] of [
    ['USD', ['1.005', '1e3', '+1', '$1', '£1', '1,20', '1.000,00', '(1)', '-0', '0.00', '10000000000', 'NaN']],
    ['JPY', ['1.0', '1.01', '1000000000000']],
    ['KWD', ['1.0001', '1000000000']],
  ] as [string, string[]][]) for (const amount of amounts)
    assert.throws(() => parse(`Date,Description,Amount\n01/02/2026,Item,"${amount}"`, currency), /Row 2/);
  for (const [code, max] of [['USD', '9999999999.99'], ['JPY', '999999999999'], ['KWD', '999999999.999']])
    assert.equal(parse(`Date,Description,Amount\n01/02/2026,Item,${max}`, code).rows[0].signedOriginalMinor, 999999999999);
});

test('raw logical rows survive while safe descriptions/references redact bank-number patterns', () => {
  const text = '\uFEFFDate,Description,Amount,Reference\r\n05/04/2026,"First line\nAccount 12345678 sort 12-34-56",-1.001,Account 87654321\r\n06/04/2026,Same purchase,-1.001,Ref\r\n06/04/2026,Same purchase,-1.001,Ref';
  const rows = parse(text, 'KWD').rows;
  assert.equal(rows.length, 3); assert.equal(rows[0].rowNumber, 2); assert.equal(rows[2].rowNumber, 4);
  assert.match(rows[0].rawCells[1], /12345678/); assert.match(rows[0].rawCells[3], /87654321/);
  assert.doesNotMatch(rows[0].description, /12345678|12-34-56/); assert.doesNotMatch(rows[0].reference, /87654321/);
  assert.equal(rows[1].signedOriginalMinor, rows[2].signedOriginalMinor);
});

test('mapping/date/schema errors hard-stop the entire parse without a partial successful result', () => {
  const text = 'Date,Description,Amount,Currency\n2026-04-05,Valid,1,USD\n2026-02-31,Invalid,1,USD';
  const base = { ...suggestMapping(readSourceCsv(text)[0], 'generic'), dateFormat: 'iso' as const };
  assert.throws(() => parseDimensionedSourceCsv(text, base, 'USD'), /Row 3.*calendar/);
  const valid = text.replace('2026-02-31', '2026-04-06');
  assert.deepEqual(parseDimensionedSourceCsv(valid, base, 'USD').rows.map(r => r.date), ['2026-04-05', '2026-04-06']);
  for (const mapping of [{ ...base, currency: 2 }, { ...base, date: '0' }, { ...base, amount: -1 },
    { ...base, currency: -2 }, { ...base, reference: 9 }, { ...base, private_key: 'hidden' },
    { ...base, amountMode: ['signed'] }, { ...base, dateFormat: 'mdy' }])
    assert.throws(() => parseDimensionedSourceCsv(valid, mapping, 'USD'));
  for (const malformed of ['a,a\nx,y', 'a,b\n"unclosed,y', 'a,b\nx,y,z'])
    assert.throws(() => parse(malformed, 'USD'));
});
