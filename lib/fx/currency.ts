/** Exact arithmetic only. This catalog does not enable foreign-currency posting. */
export const FX_CURRENCY_RULESET = 'vibecount-currencies/1';
export const FX_ROUNDING = 'nearest_minor_ties_away_from_zero/1';
export const FX_CURRENCY_SOURCE = Object.freeze({
    url: 'https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml',
    published: '2026-09-17', checked: '2026-10-17',
    sha256: '33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff',
});
export const FX_CURRENCIES = Object.freeze({
    GBP: Object.freeze({ exponent: 2, name: 'Pound Sterling' }),
    USD: Object.freeze({ exponent: 2, name: 'US Dollar' }),
    EUR: Object.freeze({ exponent: 2, name: 'Euro' }),
    JPY: Object.freeze({ exponent: 0, name: 'Yen' }),
    KWD: Object.freeze({ exponent: 3, name: 'Kuwaiti Dinar' }),
});
export type CurrencyCode = keyof typeof FX_CURRENCIES;
export const MAX_FX_MINOR = 999_999_999_999;
const MAX_RATE = BigInt('999999999999999999');
export type FxRate = {
    direction: 'target_major_per_source_major'; source_currency: CurrencyCode; target_currency: CurrencyCode;
    numerator: string; denominator: string;
};
export function currencyCode(value: unknown): CurrencyCode {
    if (typeof value !== 'string' || !Object.hasOwn(FX_CURRENCIES, value)) throw new Error('Choose an explicitly supported currency.');
    return value as CurrencyCode;
}
export function currencyMinor(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_FX_MINOR || Object.is(value, -0)) throw new Error('Use bounded exact currency minor units.');
    return value;
}
export function currencyAmount(value: unknown, currency: unknown): number {
    const code = currencyCode(currency), exponent = FX_CURRENCIES[code].exponent;
    if (typeof value !== 'string' || value.length > 32 || value !== value.trim()) throw new Error('Enter an exact currency amount without grouping or symbols.');
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!m || (m[3]?.length ?? 0) > exponent) throw new Error('Use the currency’s exact decimal places.');
    const n = BigInt(m[2]) * BigInt(10) ** BigInt(exponent) + BigInt((m[3] ?? '').padEnd(exponent, '0') || '0');
    const signed = m[1] ? -n : n;
    if (signed > BigInt(MAX_FX_MINOR) || signed < -BigInt(MAX_FX_MINOR)) throw new Error('Currency amount exceeds the supported bound.');
    return Number(signed);
}
export function displayCurrencyAmount(minor: number, currency: CurrencyCode): string {
    currencyMinor(minor); const code = currencyCode(currency), exponent = FX_CURRENCIES[code].exponent;
    const s = String(Math.abs(minor)).padStart(exponent + 1, '0');
    return code + ' ' + (minor < 0 ? '-' : '') + (exponent ? s.slice(0, -exponent) + '.' + s.slice(-exponent) : s);
}
function gcd(a: bigint, b: bigint): bigint { while (b !== BigInt(0)) { const r = a % b; a = b; b = r; } return a; }
function component(value: unknown): bigint {
    if (typeof value !== 'string' || value !== value.trim() || !/^[1-9]\d{0,17}$/.test(value)) throw new Error('Use a bounded positive rational rate.');
    return BigInt(value);
}
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Review a plain exact object.');
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length !== keys.length || keys.some(k => !Object.hasOwn(obj, k))) throw new Error('Review exact fields without additional private data.');
    return obj;
}
export function fxRate(value: unknown): FxRate {
    const p = exactObject(value, ['direction', 'source_currency', 'target_currency', 'numerator', 'denominator']);
    const source = currencyCode(p.source_currency), target = currencyCode(p.target_currency), n = component(p.numerator), d = component(p.denominator), common = gcd(n, d);
    if (p.direction !== 'target_major_per_source_major' || (source === target && n !== d)) throw new Error('Review rate direction; matching currencies require an identity rate.');
    return { direction: 'target_major_per_source_major', source_currency: source, target_currency: target, numerator: String(n / common), denominator: String(d / common) };
}
export function rateFromDecimal(source: CurrencyCode, target: CurrencyCode, value: unknown): FxRate {
    currencyCode(source); currencyCode(target);
    if (typeof value !== 'string' || value !== value.trim() || value.length > 37 || !/^\d{1,18}(?:\.\d{1,18})?$/.test(value)) throw new Error('Use an exact positive decimal unit rate.');
    const [whole, fraction = ''] = value.split('.'), n = BigInt(whole + fraction), d = BigInt(10) ** BigInt(fraction.length);
    if (n === BigInt(0)) throw new Error('A rate must be positive.');
    const common = gcd(n, d), numerator = n / common, denominator = d / common;
    if (numerator > MAX_RATE || denominator > MAX_RATE) throw new Error('Rate exceeds the exact supported bound.');
    return fxRate({ direction: 'target_major_per_source_major', source_currency: source, target_currency: target, numerator: String(numerator), denominator: String(denominator) });
}
/** Integer division/remainders avoid binary floats and decimal division precision. */
function roundRatio(n: bigint, d: bigint): bigint {
    const magnitude = n < BigInt(0) ? -n : n, whole = magnitude / d, rem = magnitude % d;
    const rounded = whole + (rem * BigInt(2) >= d ? BigInt(1) : BigInt(0));
    return n < BigInt(0) ? -rounded : rounded;
}
export function convertCurrencyMinor(sourceMinor: number, value: FxRate) {
    currencyMinor(sourceMinor); const rate = fxRate(value);
    const n = BigInt(rate.numerator) * BigInt(10) ** BigInt(FX_CURRENCIES[rate.target_currency].exponent);
    const d = BigInt(rate.denominator) * BigInt(10) ** BigInt(FX_CURRENCIES[rate.source_currency].exponent), common = gcd(n, d);
    const minorN = n / common, minorD = d / common, exact = BigInt(sourceMinor) * minorN, rounded = roundRatio(exact, minorD);
    if (rounded > BigInt(MAX_FX_MINOR) || rounded < -BigInt(MAX_FX_MINOR)) throw new Error('Converted amount exceeds the supported bound.');
    return { ruleset_id: FX_CURRENCY_RULESET, rounding: FX_ROUNDING, rate, source_minor: sourceMinor, target_minor: Number(rounded),
        minor_rate_numerator: String(minorN), minor_rate_denominator: String(minorD), exact_target_numerator: String(exact),
        rounding_delta_numerator: String(rounded * minorD - exact) };
}
/** Forward portions of ONE fixed rate/date lot only. Not an arbitrary reversal. */
export function convertCurrencyTranche(rate: FxRate, priorSource: number, priorTarget: number, portion: number) {
    currencyMinor(priorSource); currencyMinor(priorTarget); currencyMinor(portion);
    if (!portion || (priorSource !== 0 && Math.sign(priorSource) !== Math.sign(portion))) throw new Error('Use a forward portion of one unchanged conversion lot.');
    const before = convertCurrencyMinor(priorSource, rate), after = convertCurrencyMinor(currencyMinor(priorSource + portion), rate);
    if (before.target_minor !== priorTarget) throw new Error('Retained lot conversion is inconsistent; review its unchanged rate and history.');
    return { before, after, portion_source_minor: portion, portion_target_minor: currencyMinor(after.target_minor - before.target_minor), reversal_policy: 'retain_approved_portions_reverse_dependencies' as const };
}
