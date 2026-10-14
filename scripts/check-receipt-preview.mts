import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { renderReceiptPdfPage } from '../lib/records/receipt-extraction';
import { PDFDocument } from 'pdf-lib';
await mkdir('tests/receipt-verification', {recursive:true});
for (const name of ['text-receipt','scanned-receipt']) {
 const bytes=await readFile('tests/fixtures/receipts/'+name+'.pdf');
 const image=await renderReceiptPdfPage(bytes,1);
 assert.ok(image.length>1000);assert.equal(Buffer.from(image).subarray(1,4).toString(),'PNG');
 await writeFile('tests/receipt-verification/preview-'+name+'.png',image);
 await assert.rejects(renderReceiptPdfPage(bytes,2));
 console.log(name+': readable PNG preview generated; invalid page rejected');
}
const multi=await PDFDocument.create();
const doc=await PDFDocument.load(await readFile('tests/fixtures/receipts/text-receipt.pdf'));
for(let i=0;i<2;i++){const [p]=await multi.copyPages(doc,[0]);multi.addPage(p);}
await writeFile('tests/receipt-verification/two-page-receipt.pdf',await multi.save());
assert.ok((await renderReceiptPdfPage(Buffer.from(await multi.save()),2)).length>1000);
console.log('Two-page receipt: second page rendered');
