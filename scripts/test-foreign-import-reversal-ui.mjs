// Synthetic browser review; persistence captures the submitted fields only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle=await build({absWorkingDir:process.cwd(),bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import Review from './app/dashboard/imports/reversal/ForeignImportReversalReview.tsx';import {foreignImportReversalReview} from './lib/records/foreign-import-reversal.ts';
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
function Fixture(){const [v,setV]=React.useState(0),[blocked,setBlocked]=React.useState(false),[zero,setZero]=React.useState(false);const c={schema_version:'foreign-import-reversal/1',owner_id:id(1),import_id:id(2),import_status:'review',currency:'KWD',blocked,stamp:String(v).repeat(32),sources:[{id:id(3),source_row_id:id(4),date:'2026-04-05',currency:'KWD',original_signed_minor:-10001,decision_version:1,classification:'Business',record_id:id(5),record_type:'expense',approved_pence:zero?0:2500,valuation_revision_id:id(6),classification_request_id:id(7)}]};return <><button data-testid="refresh" onClick={()=>setV(v+1)}>Refresh</button><button data-testid="block" onClick={()=>setBlocked(!blocked)}>Block</button><button data-testid="zero" onClick={()=>setZero(!zero)}>Zero</button><Review review={foreignImportReversalReview(id(1),c)} requestId={id(8)}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);`},plugins:[{name:'inert-action',setup(b){b.onResolve({filter:/^\.\/foreign-actions$/},()=>({path:'action',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export async function reverseForeignImport(form){window.saved=Object.fromEntries(form.entries());await new Promise(r=>window.finishSave=r)}'}));}}]});
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);await page.goto('http://127.0.0.1:'+server.address().port);
 const field=n=>page.getByTestId('foreign-reversal-'+n),confirm=field('confirm'),submit=field('submit');
 assert.equal(await submit.isDisabled(),true);assert.match(await field('review').innerText(),/KWD -10.001 \(minus ten Kuwaiti dinars and one fil\)/);
 assert.match(await field('readback').innerText(),/Expense change: GBP -25.00/);assert.match(await field('readback').innerText(),/Profit change: GBP 25.00/);
 await field('reason').fill('Reviewed import and effects');await confirm.check();await field('reason').fill('Reviewed all source effects');assert.equal(await confirm.isChecked(),false);
 await confirm.check();await page.getByTestId('refresh').click();assert.equal(await confirm.isChecked(),false);assert.equal(await field('reason').inputValue(),'');
 await page.getByTestId('block').click();assert.equal(await field('form').count(),0);assert.match(await field('blocked').innerText(),/active invoice, transfer, refund or duplicate/);
 await page.getByTestId('block').click();await page.getByTestId('zero').click();assert.match(await field('readback').innerText(),/No approved GBP amount will be removed/);
 await field('reason').fill('Reviewed zero and retained originals');await confirm.check();await submit.click();await page.waitForFunction(()=>!!window.saved);assert.equal(await submit.isDisabled(),true);
 const saved=await page.evaluate(()=>window.saved);assert.deepEqual(Object.keys(saved).sort(),['humanConfirmed','importId','reason','requestId','stamp']);assert.equal(saved.humanConfirmed,'yes');
 await page.evaluate(()=>window.finishSave());assert.deepEqual(errors,[]);console.log('PASS: foreign reversal original units, GBP deltas, zero, blocked state, reset and pending confirmation.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
