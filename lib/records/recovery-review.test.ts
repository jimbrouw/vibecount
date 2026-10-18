import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveryReview, type RecoveryChoice } from './recovery-review';

const choice: RecoveryChoice = {
  id:'synthetic',kind:'source',state:'failed',file_hash:'a'.repeat(64),created_at:'2026-10-18',stamp:'a'.repeat(32),
  byte_count:100,object_count:1,parser:'mapped-csv/2',row_count:'2',incoming_pence:null,outgoing_pence:null,
  coverage_start:'2026-04-05',coverage_end:'2026-04-06',account_label:'Synthetic',account_mask:'1234',
  tax_year_start:null,purpose:null,destination_id:null,has_recovery_plan:true,plan_version:'2',
  account_currency:'KWD',original_currency:'KWD',currency_exponent:'3',ruleset_id:'vibecount-currencies/1',
  incoming_original_minor:'12500',outgoing_original_minor:'10001',
};
test('recovery preserves exact original dimensions and rejects GBP aliases or incomplete retained scope',()=>{
  for(const [currency,exponent] of [['USD','2'],['EUR','2'],['JPY','0'],['KWD','3']]) {
    assert.deepEqual(recoveryReview({...choice,account_currency:currency,original_currency:currency,currency_exponent:exponent}),
      {count:2,incoming:12500,outgoing:10001,currency});
  }
  for(const patch of [
    {state:'uploaded'},{plan_version:'1'},{account_currency:'USD'},{original_currency:'GBP'},
    {currency_exponent:'2'},{ruleset_id:'unknown'},{incoming_pence:'12500'},
    {incoming_original_minor:null},{outgoing_original_minor:'1e3'},{outgoing_original_minor:'-1'},
    {outgoing_original_minor:'1000000000000'},{row_count:'0'},
  ]) assert.throws(()=>recoveryReview({...choice,...patch}));
  assert.throws(()=>recoveryReview({...choice,parser:'mapped-csv/1',incoming_pence:'12500',outgoing_pence:'10001'}));
  assert.deepEqual(recoveryReview({...choice,account_currency:'GBP',parser:'mapped-csv/1',incoming_pence:'12500',outgoing_pence:'10001'}),
    {count:2,incoming:12500,outgoing:10001,currency:'GBP'});
});
