import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { extractReceipt, receiptContentType } from '../lib/records/receipt-extraction';
const categories=[{id:'12345678-1234-4234-8234-123456789abc',name:'Office costs',record_type:'expense'}];
const files=['text-receipt.pdf','scanned-receipt.pdf','photo-style-receipt.jpg','unpaid-supplier.pdf','ambiguous-total.pdf','foreign-currency.pdf','refund.pdf'];
const results=[];
for (const file of files) {
 const bytes=await readFile(new URL('../tests/fixtures/receipts/'+file,import.meta.url));
 const result=await extractReceipt(bytes,receiptContentType(bytes),categories);
 if (['text-receipt.pdf','scanned-receipt.pdf','photo-style-receipt.jpg'].includes(file)) {assert.equal(result.draft.totalPence,12000);assert.equal(result.draft.vatPence,2000);assert.equal(result.draft.paymentDate,'2026-04-06');assert.equal(result.draft.paymentStatus,'paid');}
 if(file==='text-receipt.pdf')assert.equal(result.method,'pdf_text');
 if(['scanned-receipt.pdf','photo-style-receipt.jpg'].includes(file))assert.equal(result.method,'document_vision');
 if(file==='unpaid-supplier.pdf'){assert.equal(result.draft.paymentStatus,'unpaid');assert.equal(result.draft.paymentDate,null);assert.equal(result.draft.totalPence,6000);}
 if(file==='ambiguous-total.pdf')assert.equal(result.draft.ambiguous,true);
 if(file==='foreign-currency.pdf')assert.equal(result.draft.currency,'EUR');
 if(file==='refund.pdf'){assert.equal(result.draft.kind,'refund');assert.equal(result.draft.totalPence,2400);}
 results.push({file,...result});console.log(file+': passed ('+result.method+')');
}
await writeFile(new URL('../tests/fixtures/receipts/extraction-results.json',import.meta.url),JSON.stringify(results,null,2));
