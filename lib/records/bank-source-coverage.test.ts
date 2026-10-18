import assert from 'node:assert/strict';
import test from 'node:test';
import {bankSourceCoverageFixture,bankCoverageFixtureId as id} from './bank-source-coverage-fixture';
import {parseBankSourceCoverage,nativeBankPence,bankOriginalMinor,isNativeBankObservation,readBankSourceCoverage,bankSourceCoverageBlocks} from './bank-source-coverage';

test('original-unit readback accepts only bounded exact nonzero source integers',()=>{
 assert.equal(bankOriginalMinor('-10001'),-10001);assert.equal(bankOriginalMinor(10001),10001);
 for(const v of [null,undefined,'',' ','1e3','1.0','01','+1','-0',0,-0,'0',NaN,Infinity,{},[],true,'1000000000000',1.5])assert.throws(()=>bankOriginalMinor(v));
});

test('complete source coverage reconciles owned counts, original dimensions and safe replay',()=>{
 const f=bankSourceCoverageFixture(id(1),2),c=parseBankSourceCoverage(f,id(1));assert.equal(c.counts.native_observations,2);assert.equal(bankSourceCoverageBlocks(c),false);assert.deepEqual(parseBankSourceCoverage(c,id(1)),c);
 for(const patch of [{owner_id:id(99)},{counts:{...f.counts,observations:0}},{observations:[f.observations[0]]},{accounts:[]},{observations:[f.observations[0],f.observations[0]]},{stamp:null},{scope:'selected_page_only'},{key_id:'PRIVATE'}])assert.throws(()=>parseBankSourceCoverage({...f,...patch},id(1)));
});
test('native current controls reject null, missing, malformed, foreign and contradictory currency metadata',()=>{
 const native={currency:'GBP',original_signed_minor:null,source_units_ruleset:null,signed_amount_pence:'-63029'};assert.equal(nativeBankPence(native),-63029);
 for(const patch of [{currency:'USD'},{signed_amount_pence:null},{signed_amount_pence:undefined},{signed_amount_pence:0},{signed_amount_pence:'-0'},{signed_amount_pence:'1e3'},{signed_amount_pence:'1.00'},{signed_amount_pence:NaN},{signed_amount_pence:1000000000000},{original_signed_minor:1},{original_signed_minor:undefined},{source_units_ruleset:undefined},{source_units_ruleset:'vibecount-currencies/1'}]){assert.throws(()=>nativeBankPence({...native,...patch}));assert.equal(isNativeBankObservation({...native,...patch}),false);}
});
test('unknown or failed coverage is unavailable rather than zero while foreign zero valuation still blocks',async()=>{
 const empty=bankSourceCoverageFixture();await assert.rejects(readBankSourceCoverage({rpc:async()=>({data:empty,error:{}})},id(1)));await assert.rejects(readBankSourceCoverage({rpc:async()=>({data:null,error:null})},id(1)));
 const f=bankSourceCoverageFixture(id(1),1),foreign={...f,accounts:[{...f.accounts[0],currency:'KWD',representation:'foreign'}],counts:{...f.counts,native_accounts:0,foreign_accounts:1,native_observations:0,foreign_observations:1,active_blocked_observations:1,reviewed_zero_observations:1},observations:[{...f.observations[0],currency:'KWD',signed_amount_pence:null,original_signed_minor:'1',ruleset_id:'vibecount-currencies/1',parser_version:'mapped-csv/2',representation:'foreign',valuation_status:'reviewed_zero',valuation:{id:id(40),family_id:id(41),ordinal:1,state:'reviewed',signed_gbp_pence:'0',source_current:true}}]};
 const c=parseBankSourceCoverage(foreign,id(1));assert.equal(bankSourceCoverageBlocks(c),true);assert.equal(c.observations[0].valuation!.signed_gbp_pence,'0');assert.equal(c.observations[0].signed_amount_pence,null);
 for(const patch of [{valuation_status:'unvalued'},{representation:'native_gbp'},{tax_year_start:2025},{source_available:false},{valuation:{...foreign.observations[0].valuation,state:['reviewed']}},{valuation:{...foreign.observations[0].valuation,state:'provisional'}}])assert.throws(()=>parseBankSourceCoverage({...foreign,observations:[{...foreign.observations[0],...patch}]},id(1)));
});
