import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeGbpInvoice,requireNativeGbpInvoice } from './native';
test('native invoice boundary requires explicit origin, GBP and exact non-null legacy amount',()=>{
    for(const amount of [0,'0.00','120.00',120,'9999999999.99'])assert.equal(isNativeGbpInvoice({origin:'native_gbp',currency:'GBP',amount}),true);
    for(const value of [null,[],{}, {currency:'GBP',amount:'120'}, {origin:'native_gbp',amount:'120'}, {origin:'preserved_external',currency:'GBP',amount:'120'}, {origin:'native_gbp',currency:'USD',amount:'120'}, ...[null,undefined,'','1.001','-1',NaN,Infinity,'1e3','10000000000','1'.repeat(10000)].map(amount=>({origin:'native_gbp',currency:'GBP',amount}))]){
        assert.equal(isNativeGbpInvoice(value),false);assert.throws(()=>requireNativeGbpInvoice(value),/preserved invoice evidence/);
    }
});
