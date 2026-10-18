import assert from 'node:assert/strict';
import test from 'node:test';
import { convertCurrencyMinor, convertCurrencyTranche, currencyAmount, currencyCode, currencyMinor, displayCurrencyAmount, FX_CURRENCIES, FX_CURRENCY_RULESET, fxRate, MAX_FX_MINOR, rateFromDecimal } from './currency';

test('currency scales parse exact minor units without accepting ambiguous or unsupported money', () => {
    assert.equal(currencyAmount('14033.52', 'GBP'), 1403352);
    assert.equal(currencyAmount('-630.29', 'EUR'), -63029);
    assert.equal(currencyAmount('100', 'JPY'), 100);
    assert.equal(currencyAmount('1.234', 'KWD'), 1234);
    assert.equal(currencyAmount('0001.2', 'USD'), 120);
    assert.equal(currencyAmount('-0.00', 'GBP'), 0);
    for (const code of ['constructor', '__proto__', 'gbp', 'XXX', '', null, 1]) assert.throws(() => currencyCode(code));
    for (const raw of ['1.005', '1e3', '1,000', '£1', '+1', ' 1', '1 ', '1.', '.1', '', '-', '1'.repeat(10000), 0.1, true, null]) assert.throws(() => currencyAmount(raw, 'GBP'));
    assert.throws(() => currencyAmount('1.0', 'JPY')); assert.throws(() => currencyAmount('0.0001', 'KWD'));
    assert.equal(currencyAmount('9999999999.99', 'GBP'), MAX_FX_MINOR);
    assert.throws(() => currencyAmount('10000000000.00', 'GBP'));
    for (const value of [-0, 1.1, NaN, Infinity, MAX_FX_MINOR + 1, '100']) assert.throws(() => currencyMinor(value));
    assert.equal(displayCurrencyAmount(-1, 'KWD'), 'KWD -0.001'); assert.equal(displayCurrencyAmount(100, 'JPY'), 'JPY 100');
    assert.ok(Object.isFrozen(FX_CURRENCIES)); assert.ok(Object.isFrozen(FX_CURRENCIES.GBP));
});
test('exact unit rates account for both currency exponents and explicit direction', () => {
    const usd = convertCurrencyMinor(100, rateFromDecimal('USD', 'GBP', '0.8')); assert.equal(usd.target_minor, 80);
    assert.equal(convertCurrencyMinor(100, rateFromDecimal('JPY', 'GBP', '0.005')).target_minor, 50);
    assert.equal(convertCurrencyMinor(100, rateFromDecimal('GBP', 'JPY', '200')).target_minor, 200);
    const kwd = convertCurrencyMinor(1234, rateFromDecimal('KWD', 'GBP', '2.5')); assert.equal(kwd.target_minor, 309);
    assert.equal(kwd.minor_rate_numerator, '1'); assert.equal(kwd.minor_rate_denominator, '4'); assert.equal(kwd.rounding_delta_numerator, '2');
    assert.equal(convertCurrencyMinor(-1234, kwd.rate).target_minor, -309);
    assert.equal(convertCurrencyMinor(0, usd.rate).target_minor, 0);
    assert.equal(usd.ruleset_id, FX_CURRENCY_RULESET); assert.doesNotThrow(() => JSON.stringify(usd));
    assert.deepEqual(fxRate({ ...usd.rate, numerator: '16', denominator: '20' }), usd.rate);
    assert.throws(() => rateFromDecimal('GBP', 'GBP', '0.99'));
    for (const rate of ['0', '-1', 'NaN', 'Infinity', '.5', '1.', '1e2', '1,000', ' 1', '1\n', '1'.repeat(10000), 0.8, null]) assert.throws(() => rateFromDecimal('USD', 'GBP', rate));
    for (const patch of [{ denominator: '0' }, { numerator: '-1' }, { numerator: '1\n' }, { numerator: '01' }, { denominator: '1'.repeat(10000) }, { numerator: 4 }, { direction: 'source_per_target' }, { raw_path: 'PRIVATE' }]) assert.throws(() => fxRate({ ...usd.rate, ...patch }));
    assert.throws(() => convertCurrencyMinor(MAX_FX_MINOR, rateFromDecimal('GBP', 'JPY', '1000')));
});
test('near-half rates round using exact integer remainders rather than decimal division precision', () => {
    const base = { direction: 'target_major_per_source_major', source_currency: 'USD', target_currency: 'GBP', denominator: '999999999999999999' };
    assert.equal(convertCurrencyMinor(1, fxRate({ ...base, numerator: '499999999999999999' })).target_minor, 0);
    assert.equal(convertCurrencyMinor(1, fxRate({ ...base, numerator: '500000000000000000' })).target_minor, 1);
    assert.equal(convertCurrencyMinor(-1, fxRate({ ...base, numerator: '500000000000000000' })).target_minor, -1);
});
test('forward cumulative conversion retains final zero portions and checks the unchanged lot history', () => {
    const rate = rateFromDecimal('USD', 'GBP', '0.5');
    for (const sign of [1, -1]) {
        const a = convertCurrencyTranche(rate, 0, 0, sign), b = convertCurrencyTranche(rate, sign, sign, sign);
        assert.equal(a.portion_target_minor, sign); assert.equal(b.portion_target_minor, 0); assert.equal(b.after.target_minor, sign);
        assert.equal(b.reversal_policy, 'retain_approved_portions_reverse_dependencies');
    }
    assert.throws(() => convertCurrencyTranche(rate, 1, 0, 1), /inconsistent/);
    assert.throws(() => convertCurrencyTranche(rate, 1, 1, -1), /forward/);
    assert.throws(() => convertCurrencyTranche(rateFromDecimal('USD', 'GBP', '0.4'), 1, 1, 1), /inconsistent/);
    assert.throws(() => convertCurrencyTranche(rate, 0, 0, 0));
    // Independent totals prove signed symmetry and conservation across many portions.
    for (let numerator = 1; numerator <= 11; numerator++) for (let denominator = 1; denominator <= 13; denominator++) {
        const rate = fxRate({ direction: 'target_major_per_source_major', source_currency: 'USD', target_currency: 'GBP', numerator: String(numerator), denominator: String(denominator) });
        let source = 0, target = 0;
        for (const portion of [1, 2, 7, 13, 31]) { const result = convertCurrencyTranche(rate, source, target, portion); source += portion; target += result.portion_target_minor; }
        assert.equal(target, convertCurrencyMinor(54, rate).target_minor);
        assert.equal(convertCurrencyMinor(-54, rate).target_minor, -target);
    }
});
