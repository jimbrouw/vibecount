import { currencyCode, currencyMinor, FX_CURRENCIES, fxRate, type CurrencyCode, type FxRate } from './currency';
const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function underThousand(n: number): string {
    if (n < 20) return small[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? '-'+small[n%10] : '');
    return small[Math.floor(n/100)]+' hundred'+(n%100 ? ' and '+underThousand(n%100) : '');
}
/** Exact decimal integer words, including rate components beyond Number precision. */
export function fxIntegerWords(value: string): string {
    if (!/^(0|[1-9][0-9]{0,17})$/.test(value)) throw new Error('Review a bounded exact integer.');
    let n=BigInt(value); if (!n) return 'zero';
    const result: string[]=[], scales=['','thousand','million','billion','trillion','quadrillion'];
    for(let i=0;n;i++,n/=BigInt(1000)) { const group=Number(n%BigInt(1000));if(group) result.unshift(underThousand(group)+(scales[i]?' '+scales[i]:'')); }
    return result.join(' ');
}
const units: Record<CurrencyCode, readonly [string,string,string,string]> = {
    GBP:['pound','pounds','penny','pence'],USD:['US dollar','US dollars','cent','cents'],EUR:['euro','euros','cent','cents'],JPY:['yen','yen','',''],KWD:['Kuwaiti dinar','Kuwaiti dinars','fil','fils'],
};
/** Aggregate totals may exceed a single document bound, but must remain exact safe integers. */
export function fxAggregateReadback(value: number, currency: CurrencyCode): string {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('Review an exact aggregate amount.');
    const code=currencyCode(currency),exponent=FX_CURRENCIES[code].exponent,scale=BigInt(10)**BigInt(exponent),absolute=BigInt(value<0?-value:value),whole=absolute/scale,fraction=absolute%scale,u=units[code];
    const words=(value<0?'minus ':'')+fxIntegerWords(String(whole))+' '+u[whole===BigInt(1)?0:1]+(fraction?' and '+fxIntegerWords(String(fraction))+' '+u[fraction===BigInt(1)?2:3]:'');
    const digits=String(absolute).padStart(exponent+1,'0');
    const figure=code+' '+(value<0?'-':'')+(exponent?digits.slice(0,-exponent)+'.'+digits.slice(-exponent):digits);
    return `${figure} (${words})`;
}
export function fxAmountReadback(value: number, currency: CurrencyCode): string {
    currencyMinor(value); return fxAggregateReadback(value,currency);
}
export function fxRateReadback(value: FxRate): string {
    const r=fxRate(value);return `${r.numerator}/${r.denominator} ${r.target_currency} per 1 ${r.source_currency} (${fxIntegerWords(r.numerator)} divided by ${fxIntegerWords(r.denominator)} ${r.target_currency} for one ${r.source_currency})`;
}
