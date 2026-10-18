// Shared deterministic arithmetic; safe to use in browser previews.
import { sumPence } from '../money';
import { rules2025, type TaxRules } from './rules';
export const positive = (n: number) => Math.max(0, n);
export const floorPound = (n: number) => Math.floor(n / 100) * 100;
export const ceilPound = (n: number) => Math.ceil(n / 100) * 100;
export function exact(n: unknown): number {
    if (!Number.isSafeInteger(n))
        throw new Error('Unsafe calculation amount.');
    return n as number;
}
export function ratio(n: number, mul: number, den: number, up = false) {
    const value = BigInt(exact(n)) * BigInt(mul), divisor = BigInt(den);
    if (value < BigInt(0) || den <= 0)
        throw new Error('Invalid nonnegative tax ratio.');
    const result = (value + (up ? divisor - BigInt(1) : BigInt(0))) / divisor;
    if (result > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('Tax amount out of range.');
    return Number(result);
}
export function incomeTaxBands(taxable: number, jurisdiction: string, extension: number, rules: Pick<TaxRules, 'scotland_bands' | 'ewni_bands'> = rules2025) {
    const bands = jurisdiction === 'scotland' ? rules.scotland_bands : rules.ewni_bands;
    let remainder = positive(taxable);
    return bands.map((b, i) => { const width = b.width_pence === null ? remainder : b.width_pence + (i === (jurisdiction === 'scotland' ? 1 : 0) ? extension : 0), base = Math.min(remainder, width); remainder -= base; return { base, rate_bps: b.rate_bps, tax: ratio(base, b.rate_bps, 10000) }; });
}
export function class4NI(profit: number, class1BandEarnings: number[], rules: Pick<TaxRules, 'ni'> = rules2025) {
    const ni = rules.ni, P = floorPound(positive(profit)), q = positive(P - ni.lower_pence), main = Math.min(q, ni.upper_pence - ni.lower_pence), ordinary = sumPence([ratio(main, ni.main_bps, 10000), ratio(positive(q - main), ni.additional_bps, 10000)]), E = sumPence(class1BandEarnings.map(v => ceilPound(exact(v))));
    if (E === 0 || q === 0)
        return { pence: ordinary, ordinary, reg100_cap: null, class1_equivalent: 0 };
    const C = ratio(E, ni.class1_bps, 10000, true), raw = ni.max_main_pence - C, R = positive(raw), A = ratio(R, 10000, ni.main_bps), B = Math.min(P, ni.upper_pence) - ni.lower_pence, D = positive(B - A), low = ratio(D, ni.additional_bps, 10000), high = ratio(positive(P - ni.upper_pence), ni.additional_bps, 10000);
    const conditional = BigInt(R) * BigInt(10000) > BigInt(C) * BigInt(10000) + BigInt(q) * BigInt(ni.main_bps);
    const cap = raw >= 0 ? (conditional ? R : sumPence([R, low, high])) : sumPence([low, high]);
    return { pence: Math.min(ordinary, cap), ordinary, reg100_cap: cap, class1_equivalent: C };
}
export function paymentsOnAccount(assessed: number, withheld: number, rules: Pick<TaxRules, 'poa_minimum_pence' | 'poa_relevant_ratio_bps'> = rules2025) { const relevant = positive(sumPence([assessed, -withheld])); return { relevant, each: relevant >= rules.poa_minimum_pence && BigInt(relevant) * BigInt(10000) >= BigInt(assessed) * BigInt(rules.poa_relevant_ratio_bps) ? ratio(relevant, 1, 2) : 0 }; }
