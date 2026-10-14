import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
const out = new URL('../tests/fixtures/receipts/', import.meta.url);
await mkdir(out, { recursive: true });
const text = ['VIBECOUNT TEST ONLY — NO REAL TRANSACTION', 'Studio Supply Test Shop', 'Receipt date: 05 April 2026', 'Currency: GBP', 'Subtotal: 100.00', 'VAT: 20.00', 'Grand total: 120.00', 'Cash tendered: 150.00', 'Change: 30.00', 'PAID on 06 April 2026', 'Office stationery'];
async function pdf(name: string, lines: string[]) {
 const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]); const font = await doc.embedFont(StandardFonts.Helvetica);
 lines.forEach((line, i) => page.drawText(line.replace('—','-'), { x: 45, y: 790 - i * 34, size: 15, font }));
 await writeFile(new URL(name, out), await doc.save());
}
await pdf('text-receipt.pdf', text);
await pdf('unpaid-supplier.pdf', ['VIBECOUNT TEST ONLY - NO REAL TRANSACTION', 'Studio Supplier Test Ltd', 'SUPPLIER INVOICE - UNPAID', 'Invoice date: 14 October 2026', 'Currency: GBP', 'Subtotal: 50.00', 'VAT: 10.00', 'Grand total: 60.00', 'Balance due: 60.00', 'Payment due within 30 days', 'Office stationery']);
await pdf('ambiguous-total.pdf', ['VIBECOUNT TEST ONLY - NO REAL TRANSACTION', 'Test Shop - TWO CONFLICTING TOTALS', 'Receipt date: 14 October 2026', 'Currency: GBP', 'Subtotal: 100.00', 'VAT: 20.00', 'Grand total: 120.00', 'Corrected grand total: 125.00', 'Payment status unknown']);
await pdf('foreign-currency.pdf', ['VIBECOUNT TEST ONLY - NO REAL TRANSACTION', 'Test Shop', 'Receipt date: 14 October 2026', 'Currency: EUR', 'Grand total: 25.00', 'PAID on 14 October 2026']);
await pdf('refund.pdf', ['VIBECOUNT TEST ONLY - NO REAL TRANSACTION', 'Studio Supply Test Shop', 'REFUND RECEIPT', 'Refund date: 07 April 2026', 'Currency: GBP', 'Total refund: 24.00', 'VAT refunded: 4.00', 'Refund RECEIVED on 07 April 2026']);
const canvas = createCanvas(1000, 1200); const ctx = canvas.getContext('2d');
ctx.fillStyle = '#bbb7ad'; ctx.fillRect(0,0,1000,1200); ctx.translate(80,90); ctx.rotate(-0.035);
ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=20;ctx.fillStyle='#fffff4';ctx.fillRect(0,0,860,980);ctx.shadowBlur=0;
ctx.fillStyle='#222'; ctx.font='23px monospace';
text.forEach((line,i) => ctx.fillText(line.replace('—','-'),25,65+i*65));
const png = canvas.toBuffer('image/png');
await writeFile(new URL('photo-style-receipt.png',out),png);
await writeFile(new URL('photo-style-receipt.jpg',out),canvas.toBuffer('image/jpeg'));
const scan=await PDFDocument.create();const image=await scan.embedPng(png);scan.addPage([500,600]).drawImage(image,{x:0,y:0,width:500,height:600});
await writeFile(new URL('scanned-receipt.pdf',out),await scan.save());
await writeFile(new URL('broken.pdf',out),'%PDF-1.7\nINVALID TEST FILE');
console.log('Created labelled synthetic receipt fixtures (photo-style images are not camera photographs).');
