import test from 'node:test';
import assert from 'node:assert/strict';
import {recordEffectPence,recordEffectDecimal,recordCashNote} from './accounting-effect';
import {buildSelfAssessmentChecklist} from './self-assessment';

test('live cash projections override raw receipt signs and retain excluded evidence',()=>{
 const base={record_type:'expense' as const,amount:'10.00',effect_sign:1,cash_effect_pence:'1000',cash_treatment:'recognized' as const,record_categories:null};
 const unpaid={...base,amount:'20.00',cash_effect_pence:null,cash_treatment:'unpaid' as const};
 const refund={...base,amount:'5.00',cash_effect_pence:'-500'};
 assert.equal([base,unpaid,refund].reduce((sum,r)=>sum+recordEffectPence(r),0),500);
 assert.equal(recordEffectDecimal(refund),'-5.00');assert.equal(recordEffectDecimal(unpaid),'0.00');
 assert.match(recordCashNote(unpaid)!,/Unpaid/);
 const checklist=buildSelfAssessmentChecklist([base,unpaid,refund]);
 assert.equal(checklist.expenseTotal,500);assert.equal(checklist.expenseCount,2);assert.equal(checklist.cashExcludedCount,1);
 assert.match(checklist.items[0].reviewNote,/excluded from GBP cash totals/);
 assert.throws(()=>recordEffectPence({...base,cash_effect_pence:null}),/Missing/);
 assert.throws(()=>recordEffectPence({...unpaid,cash_effect_pence:500}),/Invalid/);
 assert.throws(()=>buildSelfAssessmentChecklist([{...unpaid,cash_effect_pence:500}]),/Invalid/);
 assert.throws(()=>recordEffectPence({...base,cash_effect_pence:'9007199254740992'}),/Invalid/);
 assert.equal(recordEffectPence({amount:'5.00',effect_sign:-1}),-500,'Retained raw records keep their original signed contract');
});
