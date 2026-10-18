// Synthetic component checks with real local hashing and an inert persistence action.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const original=Buffer.from('%PDF-1.7\nSynthetic documented bank rate\n%%EOF'),hash=createHash('sha256').update(original).digest('hex');
const bundle=await build({absWorkingDir:process.cwd(),bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),sourcefile:'bank-valuation-fixture.jsx',loader:'jsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import Review from './app/dashboard/imports/valuation/BankValuationReview.tsx';import {convertCurrencyMinor,rateFromDecimal} from './lib/fx/currency.ts';
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0'),owner=id(1);
const source={schema_version:'bank-economic-source/1',owner_id:owner,transaction_id:id(2),account_id:id(3),account_currency:'KWD',import_id:id(4),source_file_id:id(5),file_sha256:'a'.repeat(64),size_bytes:100,parser_version:'mapped-csv/2',source_row_id:id(6),row_number:2,row_sha256:'b'.repeat(64),cash_date:'2026-04-05',currency:'KWD',original_signed_minor:-10001,ruleset_id:'vibecount-currencies/1'};
const evidence={document:{id:id(7),file_sha256:'${hash}',media_type:'application/pdf',size_bytes:${original.length}},available:true,invoice_scope:false,registration:{item_id:id(8),batch_id:id(9),ordinal:0,purpose:'other',tax_year_start:2025}};
const data={method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','2.5'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'},conversion=convertCurrencyMinor(-10001,data.rate);
const head={id:id(11),user_id:owner,family_id:id(12),ordinal:1,previous_revision_id:null,state:'reviewed',transaction_version:0,ruleset_id:'vibecount-currencies/1',document_id:id(7),data,source_snapshot:{economic_source:source,document_source:evidence},conversion,signed_gbp_pence:-2500,human_read_original:true,reviewed_stamp:'a'.repeat(32),rationale:'Synthetic rate',author:owner,request_id:id(10),created_at:'2026-10-18T00:00:00Z'};
function Fixture(){const [revision,setRevision]=React.useState(0),[missing,setMissing]=React.useState(false);return <><button data-testid="refresh" onClick={()=>setRevision(revision+1)}>Changed context</button><button data-testid="missing" onClick={()=>setMissing(!missing)}>Evidence unavailable</button><Review requestId={id(20+revision)} context={{schema_version:'bank-valuation-review/1',owner_id:owner,stamp:String(revision).repeat(32),transaction:{id:id(2),decision_version:0,currency:'KWD',original_signed_minor:-10001},source,head,head_current:!missing,can_change:true,documents:[{...evidence,available:!missing}]}}/></>};createRoot(window.document.getElementById('root')).render(<Fixture/>);`},plugins:[{name:'inert-action',setup(b){b.onResolve({filter:/^\.\/actions$/},()=>({path:'action',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export async function reviewBankValuation(form){window.saved=Object.fromEntries(form.entries());await new Promise(resolve=>window.finishSave=resolve)}'}));}}]});
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{const r=await digest(...args);if(window.holdDigest)await new Promise(resolve=>window.finishDigest=resolve);return r;};});
 await page.goto('http://127.0.0.1:'+server.address().port);const field=n=>page.getByTestId('bank-valuation-'+n),confirm=field('confirm'),submit=field('submit');
 await field('reason').fill('Checked documented rate');assert.match(await field('readback').innerText(),/KWD -10.001 \(minus ten Kuwaiti dinars and one fil\)/);assert.match(await field('readback').innerText(),/GBP -25.00 \(minus twenty-five pounds\)/);
 assert.match(await field('readback').innerText(),/GBP per 1 KWD/);await confirm.check();
 for(const [name,value] of [['numerator','1'],['denominator','100000'],['date','2026-04-07'],['evidence-date','2026-04-08'],['reason','Rechecked exact rate']]){await field(name).fill(value);assert.equal(await confirm.isChecked(),false);await confirm.check();}
 assert.match(await field('readback').innerText(),/nonzero original rounds to GBP zero/);
 await field('state').selectOption('reviewed');assert.equal(await confirm.isDisabled(),true);
 await field('file').setInputFiles({name:'PRIVATE-rate.pdf',mimeType:'application/pdf',buffer:original});await page.waitForFunction(()=>document.querySelector('[data-testid="bank-valuation-file-status"]').textContent.includes('Original hash matches'));
 await field('attested').check();await confirm.check();await field('numerator').fill('5');assert.equal(await field('attested').isChecked(),false);assert.equal(await confirm.isChecked(),false);
 await field('attested').check();await confirm.check();await submit.click();await page.waitForFunction(()=>!!window.saved);assert.equal(await submit.isDisabled(),true);
 const saved=await page.evaluate(()=>window.saved);assert.equal(saved.originalSha256,hash);assert.equal(JSON.parse(saved.intent).human_read_original,true);assert.doesNotMatch(JSON.stringify(saved),/PRIVATE-rate|Synthetic documented bank rate/);
 await page.evaluate(()=>window.finishSave());await page.getByTestId('refresh').click();assert.equal(await confirm.isChecked(),false);assert.equal(await field('state').inputValue(),'provisional');
 await field('state').selectOption('reviewed');await page.evaluate(()=>window.holdDigest=true);await field('file').setInputFiles({name:'original.pdf',mimeType:'application/pdf',buffer:original});await page.waitForFunction(()=>!!window.finishDigest);
 await field('state').selectOption('provisional');await field('state').selectOption('reviewed');await page.evaluate(()=>{window.holdDigest=false;window.finishDigest()});assert.equal(await field('attested').isDisabled(),true);
 await page.getByTestId('missing').click();await field('state').selectOption('withdrawn');await field('reason').fill('Withdraw stale rate evidence');assert.match(await field('readback').innerText(),/Earlier revisions remain history/);await confirm.check();assert.equal(await submit.isEnabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS: exact valuation read-back, zero rounding, local-original identity, attestation/reset/pending gates, stale hash cancellation and withdrawal history.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
