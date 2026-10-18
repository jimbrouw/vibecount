// Isolated browser component checks with synthetic files and inert server actions.
// Database and authorization behavior are tested separately against PostgreSQL.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  stdin: {
    resolveDir: process.cwd(),
    sourcefile: "import-ui-fixture.jsx",
    loader: "jsx",
    contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {TaxProfileReview,TaxFactReview,TaxSectionReview} from './app/dashboard/tax-prep/facts/TaxFactReview.tsx';
    import {MerchantRuleReview,MerchantBatchReview,MerchantBatchUndo} from './app/dashboard/review/memory/MerchantReview.tsx';
    import DuplicateReview from './app/dashboard/reconciliation/duplicates/DuplicateReview.tsx';
    import RecoveryReview from './app/dashboard/imports/recovery/RecoveryReview.tsx';
    import ImportWizard from './app/dashboard/imports/ImportWizard.tsx';
    import TransactionReview from './app/dashboard/imports/TransactionReview.tsx';
    import DocumentIntake from './app/dashboard/imports/DocumentIntake.tsx';
    import AllocationReview from './app/dashboard/reconciliation/AllocationReview.tsx';
    import TransferReview from './app/dashboard/reconciliation/transfers/TransferReview.tsx';
    import RefundAssignmentReview from './app/dashboard/reconciliation/refund-assignments/RefundAssignmentReview.tsx';
    import AssignmentReversal from './app/dashboard/reconciliation/refund-assignments/AssignmentReversal.tsx';
    import CreditReview from './app/dashboard/reconciliation/credits/CreditReview.tsx';
    import CreditReversal from './app/dashboard/reconciliation/credits/CreditReversal.tsx';
    import RefundReview from './app/dashboard/reconciliation/refunds/RefundReview.tsx';
    import RefundGroupReview from './app/dashboard/reconciliation/refunds/RefundGroupReview.tsx';
    function TaxFixture(){const [revision,setRevision]=React.useState(0),[editing,setEditing]=React.useState(false);const scope={year:2025,stamp:'tax-'+revision,requestId:'tax-'+revision};return <section><button data-testid="tax-new-snapshot" onClick={()=>setRevision(revision+1)}>Changed tax-year snapshot</button><button data-testid="tax-load-edit" onClick={()=>setEditing(true)}>Load saved employment</button><TaxProfileReview {...scope}/><TaxFactReview {...scope} kind="employment" fact={editing?{id:'saved-tax',family_id:'saved-family',ordinal:1,kind:'employment',label:'Saved synthetic employment',tax_year_start:2025,state:'verified',data:{taxable_pay_pence:1403352,income_tax_withheld_pence:154260,class1_band_earnings_pence:null,statement_basis:'p45_current_employment',period_start:'2025-04-06',period_end:'2026-04-05'},rationale:'Original review',created_at:'2026-10-17'}:undefined} selected={{document_ids:editing?['tax-doc']:[],transaction_ids:[],record_ids:[]}} documents={[{id:'tax-doc',label:'Synthetic P45 SHA-256 '+ 'a'.repeat(64)}]} transactions={[]} records={[]}/><TaxSectionReview {...scope} kind="pension" activeCount={0} provisionalCount={0}/></section>}
    function MerchantFixture(){const [revision,setRevision]=React.useState(0);const tx={id:'memory-row',account_id:'memory-bank',import_id:'memory-import',source_row_id:'source-row',transaction_date:'2025-07-06',signed_amount_pence:-63029,currency:'GBP',original_signed_minor:null,source_units_ruleset:null,description:'Synthetic repair',reference:'',fingerprint:'f'.repeat(64),classification:'Unknown',decision_version:revision,dedupe_status:'clear',active_duplicate_decision_id:null,account_label:'Synthetic bank',account_mask:'1234',import_status:'review',file_hash:'a'.repeat(64),parser_version:'test',row_number:2,row_hash:'b'.repeat(64),record_type:null,record_status:null,recognized_pence:0,peer_count:0,incoming_duplicate_count:0,has_financial_dependencies:false,tax_year_start:2025,merchant_key:'synthetic repair',rule_candidates:[],top_rule_count:0,suggested_rule_version_id:null};const categories=[{id:'memory-category',name:'Travel costs',record_type:'expense'}];return <section><button data-testid="merchant-new-snapshot" onClick={()=>setRevision(revision+1)}>Changed merchant snapshot</button><MerchantRuleReview seed={tx} categories={categories} accounts={[{id:'memory-bank',label:'Synthetic bank',masked_identifier:'1234'}]} stamp={'stamp-'+revision} requestId={'rule-'+revision}/><MerchantBatchReview rows={[tx,{...tx,id:'memory-personal',classification:'Personal'}]} categories={categories} documents={[{id:'doc1',file_hash:'c'.repeat(64),media_type:'application/pdf'}]} stamp={'stamp-'+revision} requestId={'batch-'+revision}/><MerchantBatchUndo batchId="batch" rows={[{...tx,classification:'Mixed',record_type:'expense',recognized_pence:18909,decision_version:revision+1}]} versions={[{transaction_id:'memory-row',after_version:revision+1}]} stamp={'stamp-'+revision} requestId={'undo-'+revision}/></section>}
    function RecoveryFixture({foreign=false}){const [revision,setRevision]=React.useState(0);const choice={id:'recovery-source',kind:'source',state:'failed',file_hash:'a'.repeat(64),created_at:'2026-10-17',stamp:'recovery-'+revision,byte_count:100,object_count:1,parser:'mapped-csv/1',row_count:'8',incoming_pence:'202500',outgoing_pence:'121838',coverage_start:'2025-07-01',coverage_end:'2026-04-06',account_label:'Synthetic Starling',account_mask:'1234',tax_year_start:null,purpose:null,destination_id:revision?'existing-import':null,has_recovery_plan:true};if(foreign)Object.assign(choice,{id:'recovery-foreign',parser:'mapped-csv/2',plan_version:'2',account_currency:'KWD',original_currency:'KWD',currency_exponent:'3',ruleset_id:'vibecount-currencies/1',incoming_pence:null,outgoing_pence:null,incoming_original_minor:'12500',outgoing_original_minor:revision?'10002':'10001'});return <section><button data-testid={foreign?'recovery-foreign-snapshot':'recovery-new-snapshot'} onClick={()=>setRevision(revision+1)}>Changed recovery snapshot</button><RecoveryReview choice={choice} requestId={'recovery-'+revision}/></section>}
    function DuplicateFixture(){const [revision,setRevision]=React.useState(0);const base={id:'dup-subject',account_id:'dup-account',import_id:'dup-import',source_row_id:'dup-row',transaction_date:'2026-04-05',signed_amount_pence:150000,currency:'GBP',description:'Synthetic receipt',reference:'safe',fingerprint:'f'.repeat(64),classification:'Business',decision_version:revision+1,dedupe_status:'clear',active_duplicate_decision_id:null,account_label:'Synthetic bank',account_mask:'1234',import_status:'review',file_hash:'a'.repeat(64),parser_version:'test',row_number:2,row_hash:'b'.repeat(64),record_type:'income',record_status:'approved',recognized_pence:150000,peer_count:1,incoming_duplicate_count:0,has_financial_dependencies:false};return <section><button data-testid="duplicate-new-snapshot" onClick={()=>setRevision(revision+1)}>Changed duplicate evidence</button><DuplicateReview subject={base} peers={[{...base,id:'dup-retained',file_hash:'c'.repeat(64)}]} stamp={'stamp-'+revision} requestId={'dup-'+revision}/></section>}
    function AssignmentFixture(){const [revision,setRevision]=React.useState(0);const choice={id:'assignment-choice',credit_id:'credit',credit_number:'CN-120-001',credit_pdf_sha256:'c'.repeat(64),allocation_id:'allocation',refund_id:'refund',original_transaction_id:'receipt',refund_transaction_id:'returned',invoice_id:'invoice',invoice_number:'INV-120',invoice_pence:12000,allocated_pence:12000,credited_pence:3000,returned_pence:0,credit_remaining_pence:3000,allocation_remaining_pence:12000,refund_remaining_pence:3000};return <section><button data-testid="assignment-new-snapshot" onClick={()=>setRevision(revision+1)}>Changed assignment snapshot</button><RefundAssignmentReview choice={choice} stamp={'snapshot-'+revision} requestId={'assignment-'+revision}/><AssignmentReversal id="assignment" amount={3000} stamp={'snapshot-'+revision} requestId={'unmatch-'+revision} invoice={{invoice_pence:12000,credited_pence:3000,allocated_pence:12000,returned_pence:3000}}/></section>}
    function CreditFixture(){const [revision,setRevision]=React.useState(0);const invoice={id:'credit-invoice',number:'SYNTHETIC-120',invoice_date:'2026-04-05',status:'finalised',currency:'GBP',updated_at:'synthetic-'+revision,invoice_pence:12000,allocated_pence:12000,outstanding_pence:0,credited_pence:0,entitlement_pence:12000,refund_due_pence:0,net_pence:revision?null:10000,vat_pence:revision?null:2000,credited_net_pence:0,credited_vat_pence:0,vat_rate_bps:2000,vat_number_snapshot:'GB-SYNTHETIC',economics_version:revision?0:1,balance_stamp:'a'.repeat(32)};return <section><button data-testid="credit-new-snapshot" onClick={()=>setRevision(revision+1)}>Change credit snapshot to unresolved VAT</button><CreditReview invoice={invoice} parties={{sellerName:'Synthetic supplier',sellerAddress:'',clientName:'Synthetic client',clientAddress:''}} today="2026-10-17" requestId={'credit-'+revision}/><CreditReversal creditId="synthetic-credit" gross={3000} invoice={{...invoice,credited_pence:3000}} requestId="reverse-credit"/></section>}
    function RefundFixture(){const [revision,setRevision]=React.useState(0);const base={id:'original-'+revision,account_id:'bank',import_id:'original-import',transaction_date:'2026-04-05',signed_amount_pence:-63029,currency:'GBP',description:'Synthetic car repair',account_label:'Synthetic bank',account_mask:'1234',account_type:'bank',classification:'Mixed',decision_version:1,dedupe_status:'clear',active_transfer_id:null,active_refund_id:null,has_refunds:false,import_status:'review',record_status:'approved',recognized_pence:18909,invoice_allocated_pence:0,business_use_bps:3000,record_type:'expense',effect_sign:1,category_id:'travel',refunded_pence:0,reduced_pence:0,refund_count:0,refund_stamp:'a'.repeat(32)};const refund={...base,id:'refund-'+revision,import_id:'refund-import',transaction_date:'2026-04-06',signed_amount_pence:10000,description:'Synthetic supplier refund',classification:'Unknown',record_status:null,recognized_pence:0,effect_sign:null};return <section id="refund-fixture"><button data-testid="refund-new-snapshot" onClick={()=>setRevision(revision+1)}>Changed refund snapshot</button><RefundReview original={base} refund={refund} requestId={'refund-'+revision}/><RefundGroupReview original={{...base,refunded_pence:10000,reduced_pence:3000,refund_count:1}} members={[{id:'link',original_transaction_id:base.id,amount_pence:10000,recognized_pence:3000,refund:{transaction_date:'2026-04-06',description:'Synthetic supplier refund',import_id:'refund-import',financial_accounts:{label:'Synthetic bank',masked_identifier:'1234'}}}]} requestId={'reverse-'+revision}/></section>}
    function TransferFixture(){const [revision,setRevision]=React.useState(0);const base={import_id:'source',transaction_date:'2026-04-05',currency:'GBP',description:'Synthetic transfer',classification:'Business',decision_version:1,dedupe_status:'clear',active_transfer_id:null,import_status:'review',record_status:'approved',recognized_pence:30000,invoice_allocated_pence:0};return <><button data-testid="transfer-new-snapshot" onClick={()=>setRevision(revision+1)}>Simulate changed transfer snapshot</button><TransferReview requestId={'transfer-'+revision} outgoing={{...base,id:'out-'+revision,account_id:'bank-account',account_label:'Synthetic bank',account_mask:'1234',account_type:'bank',signed_amount_pence:-30000}} incoming={{...base,id:'in-'+revision,account_id:'card-account',account_label:'Synthetic Amex',account_mask:'5678',account_type:'credit_card',signed_amount_pence:30000}}/></>}
    function AllocationFixture(){const [revision,setRevision]=React.useState(0);return <><button data-testid="allocation-new-snapshot" onClick={()=>setRevision(revision+1)}>Simulate changed review snapshot</button><AllocationReview proposals={[{invoice_id:'invoice-test',amount_pence:50000,invoice_updated_at:'2026-01-01T00:00:00Z',strength:'review',reasons:['Receipt reference matches; partial settlement requires review.'],warnings:['Synthetic alternative: choose explicitly.'],score:100,rules_version:'invoice-match/1',ambiguous:true}]} requestId={'request-'+revision} receipt={{id:'receipt-'+revision,signed_amount_pence:150000,allocated_pence:0,unallocated_pence:150000,decision_version:1,classification:'Business',business_use_bps:10000,dedupe_status:'clear',record_status:'approved',recognized_pence:150000,currency:'GBP'}} invoices={[{id:'invoice-test',number:'SYNTHETIC-1500',invoice_pence:150000,allocated_pence:0,outstanding_pence:150000,updated_at:'2026-01-01T00:00:00Z',currency:'GBP',status:'finalised'}]}/></>}
    createRoot(document.getElementById('root')).render(<>
      <ImportWizard accounts={[{id:'account-test',label:'Synthetic Starling',provider:'starling',masked_identifier:'1234'}]}/>
      <TransactionReview tx={{id:'tx-test',import_id:'import-test',transaction_date:'2026-04-05',signed_amount_pence:-63029,currency:'GBP',original_signed_minor:null,source_units_ruleset:null,description:'Synthetic car repair',reference:'',classification:'Unknown',decision_version:0,business_use_bps:0,category_id:null,dedupe_status:'clear',source_row_id:'row-test'}} categories={[{id:'expense-test',name:'Travel costs',record_type:'expense'}]}/>
      <DocumentIntake currentYear={2026}/>
      <AllocationFixture/>
      <TransferFixture/>
      <RefundFixture/>
      <CreditFixture/>
      <AssignmentFixture/>
      <DuplicateFixture/>
      <RecoveryFixture/>
      <RecoveryFixture foreign/>
      <MerchantFixture/>
      <TaxFixture/>
    </>);`,
  },
  plugins: [
    {
      name: "inert-test-actions",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "test-navigation",
          namespace: "fixture-navigation",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "fixture-navigation" },
          () => ({
            contents: "export function useRouter(){return {refresh(){}}}",
            loader: "js",
          }),
        );
        builder.onResolve({ filter: /^\.\/actions$/ }, () => ({
          path: "test-actions",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export async function importSourceCsv(){}; export async function importSourceGroup(){return {importId:"synthetic-group",created:true}}; export async function classifySourceTransaction(){}; export async function approveAllocations(){}; export async function approveTransfer(){}; export async function approveRefund(){}; export async function reverseRefundGroup(){}; export async function reverseCredit(){}; export async function approveInvoiceRefund(){}; export async function reverseInvoiceRefund(){}; export async function approveDuplicate(){}; export async function reverseDuplicate(){};export async function recoverUpload(){await new Promise(r=>setTimeout(r,1200))};export async function saveMerchantRule(){};export async function saveMerchantRollover(){};export async function approveMerchantBatch(){};export async function undoMerchantBatch(){};export async function reviewTaxInputs(){};",
          loader: "js",
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic import UI test</title></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const systemChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.VIBECOUNT_TEST_BROWSER ||
  (existsSync(systemChrome) ? systemChrome : undefined);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "slow.csv")
        await new Promise((r) => setTimeout(r, 200));
      return read.call(this);
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const file = (name, description, amount) => ({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Date,Counter Party,Amount (GBP)\n05/04/2026,${description},${amount}`,
    ),
  });
  await page
    .getByTestId("source-file-input")
    .setInputFiles(file("slow.csv", "OLD preview", 100));
  await page
    .getByTestId("source-file-input")
    .setInputFiles(file("new.csv", "NEW preview", 275));
  await page.getByTestId("source-preview").waitFor();
  await page.waitForTimeout(250); // Let the deliberately delayed, superseded read finish.
  const preview = await page.getByTestId("source-preview").innerText();
  assert.ok(preview.includes("NEW preview"));
  assert.ok(!preview.includes("OLD preview"));
  assert.ok(preview.includes("£275.00"));
  assert.equal(
    await page.getByTestId("source-import-submit").isDisabled(),
    true,
  );
  await page.getByTestId("source-mapping-confirm").check();
  assert.equal(
    await page.getByTestId("source-import-submit").isEnabled(),
    true,
  );
  await page.getByTestId("source-settings-toggle").click();
  await page.getByTestId("source-date-format").selectOption("iso");
  assert.equal(await page.getByTestId("source-mapping-confirm").count(), 0);
  assert.equal(
    await page.getByTestId("source-import-submit").isDisabled(),
    true,
  );
  await page.getByTestId("source-date-format").selectOption("dmy");
  assert.equal(
    await page.getByTestId("source-mapping-confirm").isChecked(),
    false,
  );
  await page
    .getByTestId("source-transaction-tx-test")
    .locator("summary")
    .click();
  await page.getByTestId("source-classification-tx-test").selectOption("Mixed");
  await page
    .getByTestId("source-category-tx-test")
    .selectOption("expense-test");
  await page
    .getByTestId("source-rationale-tx-test")
    .fill("Reviewed synthetic evidence");
  const share = await page.getByTestId("source-share-tx-test").innerText();
  assert.ok(share.includes("£189.09"));
  assert.ok(
    share.includes("one hundred and eighty-nine pounds and nine pence"),
  );
  await page.getByTestId("source-confirm-tx-test").check();
  await page.getByTestId("source-percent-tx-test").fill("45");
  assert.equal(
    await page.getByTestId("source-confirm-tx-test").isChecked(),
    false,
  );
  await page
    .getByTestId("source-classification-tx-test")
    .selectOption("Personal");
  assert.ok(
    (await page.getByTestId("source-share-tx-test").innerText()).includes(
      "£0.00",
    ),
  );
  await page.getByTestId("document-intake-file").setInputFiles({
    name: "synthetic-p45.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nSynthetic employment evidence\n%%EOF"),
  });
  assert.equal(
    await page.getByTestId("document-intake-submit").isDisabled(),
    true,
  );
  await page.getByTestId("document-intake-confirm").check();
  assert.equal(
    await page.getByTestId("document-intake-submit").isEnabled(),
    true,
  );
  await page.getByTestId("document-intake-purpose").selectOption("employment");
  assert.equal(
    await page.getByTestId("document-intake-confirm").isChecked(),
    false,
  );
  await page.getByTestId("document-intake-confirm").check();
  await page.getByTestId("document-intake-year").fill("2025");
  assert.equal(
    await page.getByTestId("document-intake-confirm").isChecked(),
    false,
  );
  await page.getByTestId("document-intake-confirm").check();
  let submitted = false;
  await page.route("**/api/evidence/intake", async (route) => {
    const body = route.request().postDataBuffer().toString();
    assert.ok(body.includes('name="preserveConfirmed"\r\n\r\nyes'));
    assert.ok(body.includes('name="purpose"\r\n\r\nemployment'));
    assert.ok(body.includes('name="taxYearStart"\r\n\r\n2025'));
    submitted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        created: true,
        batch_id: "synthetic-batch",
        files: 1,
      }),
    });
  });
  await page.getByTestId("document-intake-submit").click();
  await page
    .getByTestId("document-intake-result")
    .filter({ hasText: "Evidence preserved as unresolved" })
    .waitFor();
  assert.equal(submitted, true);
  assert.equal(
    await page.getByTestId("document-intake-confirm").isChecked(),
    false,
  );
  assert.equal(
    await page.getByTestId("document-intake-submit").isDisabled(),
    true,
  );
  await page.getByTestId("match-use-invoice-test").click();
  assert.equal(await page.getByTestId("allocation-amount-invoice-test").inputValue(),"500.00");
  assert.equal(await page.getByTestId("allocation-confirm").isChecked(),false);
  await page.getByTestId("allocation-amount-invoice-test").fill("500");
  await page
    .getByTestId("allocation-reason")
    .fill("Reviewed synthetic reference");
  const allocationReadback = await page
    .getByTestId("allocation-readback")
    .innerText();
  assert.ok(allocationReadback.includes("£500.00"));
  assert.ok(allocationReadback.includes("five hundred pounds"));
  assert.ok(allocationReadback.includes("£1,000.00"));
  await page.getByTestId("allocation-confirm").check();
  assert.equal(await page.getByTestId("allocation-submit").isEnabled(), true);
  await page.getByTestId("match-use-invoice-test").click();
  assert.equal(await page.getByTestId("allocation-confirm").isChecked(),false);
  await page.getByTestId("allocation-amount-invoice-test").fill("500.01");
  assert.equal(await page.getByTestId("allocation-confirm").isChecked(), false);
  await page.getByTestId("allocation-confirm").check();
  await page.getByTestId("allocation-new-snapshot").click();
  assert.equal(await page.getByTestId("allocation-confirm").isChecked(), false);
  assert.equal(
    await page.getByTestId("allocation-amount-invoice-test").inputValue(),
    "",
  );
  assert.equal(await page.getByTestId("allocation-submit").isDisabled(), true);
  await page.getByTestId("allocation-amount-invoice-test").fill("1500.01");
  assert.equal(await page.getByTestId("allocation-confirm").isDisabled(), true);
  await page
    .getByTestId("transfer-reason")
    .fill("Reviewed both synthetic sources");
  const transferReadback = await page
    .getByTestId("transfer-readback")
    .innerText();
  assert.ok(transferReadback.includes("£300.00"));
  assert.ok(transferReadback.includes("three hundred pounds"));
  assert.ok(
    transferReadback.includes(
      "Purchases on that card retain their separate review decisions",
    ),
  );
  await page.getByTestId("transfer-confirm").check();
  assert.equal(await page.getByTestId("transfer-submit").isEnabled(), true);
  await page.getByTestId("transfer-kind").selectOption("transfer");
  assert.equal(await page.getByTestId("transfer-confirm").isChecked(), false);
  assert.equal(await page.getByTestId("transfer-submit").isDisabled(), true);
  await page.getByTestId("transfer-kind").selectOption("card_repayment");
  await page.getByTestId("transfer-confirm").check();
  await page.getByTestId("transfer-reason").fill("Amended reviewed reason");
  assert.equal(await page.getByTestId("transfer-confirm").isChecked(), false);
  await page.getByTestId("transfer-confirm").check();
  await page.getByTestId("transfer-new-snapshot").click();
  assert.equal(await page.getByTestId("transfer-confirm").isChecked(), false);
  assert.equal(await page.getByTestId("transfer-reason").inputValue(), "");
  const refundReadback = await page.getByTestId("refund-readback").innerText();
  assert.match(refundReadback, /Reduce expenses by £30.00/);
  assert.match(refundReadback, /thirty pounds/);
  assert.match(refundReadback, /£100.00/);
  await page.getByTestId("refund-reason").fill("Checked both sources");
  await page.getByTestId("refund-confirm").check();
  assert.equal(await page.getByTestId("refund-approve").isEnabled(), true);
  await page.getByTestId("refund-reason").fill("Amended source reason");
  assert.equal(await page.getByTestId("refund-confirm").isChecked(), false);
  await page.getByTestId("refund-group-reason").fill("Reverse complete group");
  await page.getByTestId("refund-group-confirm").check();
  assert.equal(await page.getByTestId("refund-group-submit").isEnabled(), true);
  await page.getByTestId("refund-group-reason").fill("Changed group reason");
  assert.equal(
    await page.getByTestId("refund-group-confirm").isChecked(),
    false,
  );
  await page.getByTestId("refund-confirm").check();
  await page.getByTestId("refund-group-confirm").check();
  await page.getByTestId("refund-new-snapshot").click();
  assert.equal(await page.getByTestId("refund-confirm").isChecked(), false);
  assert.equal(
    await page.getByTestId("refund-group-confirm").isChecked(),
    false,
  );
  assert.equal(await page.getByTestId("refund-approve").isDisabled(), true);
  await page.getByTestId("credit-amount").fill("30.00");
  await page.getByTestId("credit-reason").fill("Reviewed original supply");
  const creditEffects = await page.getByTestId("credit-effects").innerText();
  assert.match(creditEffects, /Net: £25.00 \(twenty-five pounds\)/);
  assert.match(creditEffects, /VAT: £5.00 \(five pounds\)/);
  assert.match(creditEffects, /£120.00.*£90.00/);
  assert.match(creditEffects, /£0.00.*£30.00/);
  await page.getByTestId("credit-confirm").check();
  assert.equal(await page.getByTestId("credit-submit").isEnabled(), true);
  await page.getByTestId("credit-sellerName").fill("Changed supplier");
  assert.equal(await page.getByTestId("credit-confirm").isChecked(), false);
  await page.getByTestId("credit-confirm").check();
  await page.getByTestId("credit-new-snapshot").click();
  assert.equal(await page.getByTestId("credit-confirm").isChecked(), false);
  assert.equal(await page.getByTestId("credit-amount").inputValue(), "");
  await page.getByTestId("credit-amount").fill("30.00");
  await page.getByTestId("credit-reason").fill("Unverified legacy VAT");
  assert.equal(await page.getByTestId("credit-confirm").isDisabled(), true);
  await page.getByTestId("credit-unknown-vat").check();
  await page.getByTestId("credit-confirm").check();
  await page.getByTestId("credit-date").fill("2026-10-16");
  assert.equal(await page.getByTestId("credit-confirm").isChecked(), false);
  await page.getByTestId("credit-reversal-reason").fill("Reviewed reversal");
  await page.getByTestId("credit-reversal-confirm").check();
  assert.equal(
    await page.getByTestId("credit-reversal-submit").isEnabled(),
    true,
  );
  await page.getByTestId("credit-reversal-reason").fill("Changed reversal");
  assert.equal(
    await page.getByTestId("credit-reversal-confirm").isChecked(),
    false,
  );
  await page.getByTestId("refund-assignment-amount").fill("30.00");
  await page
    .getByTestId("refund-assignment-reason")
    .fill("Checked recorded return and credit");
  const assignmentEffects = await page
    .getByTestId("refund-assignment-effects")
    .innerText();
  assert.match(assignmentEffects, /thirty pounds/);
  assert.match(assignmentEffects, /£120.00.*£90.00/);
  assert.match(assignmentEffects, /£30.00.*£0.00/);
  assert.match(assignmentEffects, /Recognised income\/expense change: £0.00/);
  await page.getByTestId("refund-assignment-confirm").check();
  assert.equal(
    await page.getByTestId("refund-assignment-submit").isEnabled(),
    true,
  );
  await page.getByTestId("refund-assignment-amount").fill("29.00");
  assert.equal(
    await page.getByTestId("refund-assignment-confirm").isChecked(),
    false,
  );
  await page.getByTestId("refund-assignment-confirm").check();
  await page.getByTestId("assignment-new-snapshot").click();
  assert.equal(
    await page.getByTestId("refund-assignment-amount").inputValue(),
    "",
  );
  assert.equal(
    await page.getByTestId("refund-assignment-confirm").isChecked(),
    false,
  );
  await page
    .getByTestId("assignment-reversal-reason")
    .fill("Checked before unmatching");
  await page.getByTestId("assignment-reversal-confirm").check();
  assert.equal(
    await page.getByTestId("assignment-reversal-submit").isEnabled(),
    true,
  );
  await page
    .getByTestId("assignment-reversal-reason")
    .fill("Changed reversal scope");
  assert.equal(
    await page.getByTestId("assignment-reversal-confirm").isChecked(),
    false,
  );
  await page.getByTestId("duplicate-verdict").selectOption("duplicate");
  assert.equal(await page.getByTestId("duplicate-submit").isDisabled(),true);
  await page.getByTestId("duplicate-retained").selectOption("dup-retained");
  const identityReadback=await page.getByTestId("duplicate-readback").innerText();
  assert.ok(identityReadback.includes("£1,500.00"));
  assert.ok(identityReadback.includes("one thousand five hundred pounds"));
  await page.getByTestId("duplicate-reason").fill("Checked complete cohort");
  await page.getByTestId("duplicate-confirm").check();
  assert.equal(await page.getByTestId("duplicate-submit").isEnabled(),true);
  await page.getByTestId("duplicate-verdict").selectOption("distinct");
  assert.equal(await page.getByTestId("duplicate-confirm").isChecked(),false);
  assert.ok((await page.getByTestId("duplicate-readback").innerText()).includes("Remove recognised income: £0.00"));
  assert.ok((await page.getByTestId("duplicate-readback").innerText()).includes("separate real payment"));
  await page.getByTestId("duplicate-confirm").check();
  await page.getByTestId("duplicate-reason").fill("Changed reason");
  assert.equal(await page.getByTestId("duplicate-confirm").isChecked(),false);
  await page.getByTestId("duplicate-confirm").check();
  await page.getByTestId("duplicate-new-snapshot").click();
  assert.equal(await page.getByTestId("duplicate-confirm").isChecked(),false);
  assert.equal(await page.getByTestId("duplicate-verdict").inputValue(),"");
  const foreignRecovery=await page.getByTestId('recovery-readback-recovery-foreign').innerText();
  assert.match(foreignRecovery,/KWD 10.001 \(ten Kuwaiti dinars and one fil\)/);
  assert.match(foreignRecovery,/GBP valuation and financial classification require separate review/);
  await page.getByTestId('recovery-reason-recovery-foreign').fill('Checked original KWD amounts');
  await page.getByTestId('recovery-confirm-recovery-foreign').check();
  await page.getByTestId('recovery-foreign-snapshot').click();
  assert.equal(await page.getByTestId('recovery-confirm-recovery-foreign').isChecked(),false);
  assert.match(await page.getByTestId('recovery-readback-recovery-foreign').innerText(),/KWD 10.002/);
  await page.getByTestId('recovery-reason-recovery-foreign').fill('Checked changed original KWD amounts');
  await page.getByTestId('recovery-confirm-recovery-foreign').check();
  await page.getByTestId('recovery-submit-recovery-foreign').click();
  await page.getByTestId('recovery-submit-recovery-foreign').filter({hasText:'Verifying preserved originals'}).waitFor();
  assert.equal(await page.getByTestId('recovery-submit-recovery-foreign').isDisabled(),true);
  const recoveryCopy=await page.getByTestId("recovery-readback-recovery-source").innerText();
  assert.ok(recoveryCopy.includes("£2,025.00"));assert.ok(recoveryCopy.includes("two thousand twenty-five pounds"));assert.ok(recoveryCopy.includes("£0.00"));assert.ok(recoveryCopy.includes("existing treatment is retained"));
  await page.getByTestId("recovery-reason-recovery-source").fill("Checked preserved source scope");
  assert.equal(await page.getByTestId("recovery-submit-recovery-source").isDisabled(),true);
  await page.getByTestId("recovery-confirm-recovery-source").check();
  assert.equal(await page.getByTestId("recovery-submit-recovery-source").isEnabled(),true);
  await page.getByTestId("recovery-reason-recovery-source").fill("Changed recovery reason");
  assert.equal(await page.getByTestId("recovery-confirm-recovery-source").isChecked(),false);
  await page.getByTestId("recovery-confirm-recovery-source").check();
  await page.getByTestId("recovery-new-snapshot").click();
  assert.equal(await page.getByTestId("recovery-confirm-recovery-source").isChecked(),false);
  assert.ok((await page.getByTestId("recovery-readback-recovery-source").innerText()).includes("existing treatment is retained"));
  const batch=page.getByTestId('merchant-batch-form'),rule=page.getByTestId('merchant-rule-form'),undo=page.getByTestId('merchant-undo-form');
  assert.equal(await batch.getByTestId('merchant-submit').isDisabled(),true);
  await page.getByTestId('merchant-select-memory-row').check();
  await page.getByTestId('merchant-treatment-memory-row').selectOption('Mixed');
  await page.getByTestId('merchant-percent-memory-row').fill('30');
  await page.getByTestId('merchant-category-memory-row').selectOption('memory-category');
  const merchantCopy=await page.getByTestId('merchant-readback-memory-row').innerText();assert.ok(merchantCopy.includes('£189.09'));assert.ok(merchantCopy.includes('one hundred and eighty-nine pounds and nine pence'));
  await page.getByTestId('merchant-batch-reason').fill('Reviewed business share');await batch.getByTestId('merchant-confirm').check();assert.equal(await batch.getByTestId('merchant-submit').isEnabled(),true);
  const sent=JSON.parse(await batch.locator('input[name="entries"]').inputValue());assert.equal(sent.length,1);assert.equal(sent[0].transaction_id,'memory-row');assert.equal(sent[0].business_use_bps,3000);
  await page.getByTestId('merchant-percent-memory-row').fill('45');assert.equal(await batch.getByTestId('merchant-confirm').isChecked(),false);
  await page.getByTestId('merchant-select-memory-personal').check();assert.equal(await batch.getByTestId('merchant-submit').isDisabled(),true);await page.getByTestId('merchant-treatment-memory-personal').selectOption('Personal');assert.equal(JSON.parse(await batch.locator('input[name="entries"]').inputValue())[1].origin,'override');
  await batch.getByTestId('merchant-confirm').check();await page.getByTestId('merchant-evidence-memory-row').selectOption('linked');assert.equal(await batch.getByTestId('merchant-confirm').isChecked(),false);assert.equal(await batch.getByTestId('merchant-confirm').isDisabled(),true);await page.getByTestId('merchant-documents-memory-row').selectOption(['doc1']);await batch.getByTestId('merchant-confirm').check();
  await page.getByTestId('merchant-rule-treatment').selectOption('Personal');await page.getByTestId('merchant-rule-reason').fill('Personal lodging retained');await rule.getByTestId('merchant-confirm').check();assert.ok((await page.getByTestId('merchant-rule-readback').innerText()).includes('£0.00'));
  await page.getByTestId('merchant-rule-year').fill('2026');assert.equal(await rule.getByTestId('merchant-confirm').isChecked(),false);
  assert.ok((await page.getByTestId('merchant-undo-readback').innerText()).includes('£189.09'));await undo.locator('input[name="reason"]').fill('Undo entire reviewed batch');await undo.getByTestId('merchant-confirm').check();
  await page.getByTestId('merchant-new-snapshot').click();assert.equal(await rule.getByTestId('merchant-confirm').isChecked(),false);assert.equal(await batch.getByTestId('merchant-confirm').isChecked(),false);assert.equal(await page.getByTestId('merchant-select-memory-row').isChecked(),false);assert.equal(await undo.getByTestId('merchant-confirm').isChecked(),false);
  const taxProfile=page.getByTestId('tax-profile-form'),taxInput=page.getByTestId('tax-input-form'),taxSection=page.getByTestId('tax-section-form');
  await page.getByTestId('tax-profile-state').selectOption('reviewed');assert.equal(await taxProfile.getByTestId('tax-fact-confirm').isDisabled(),true);
  for(const [key,value] of Object.entries({jurisdiction:'england_wales_ni',accounting_basis:'cash',business_structure:'sole_trader',vat_registered:'no',student_loan:'none',residency:'uk_full_year',special_reliefs:'none',ledger_completeness:'complete'}))await page.getByTestId('tax-profile-'+key).selectOption(value);
  await page.getByTestId('tax-profile-reason').fill('Checked supported profile');await taxProfile.getByTestId('tax-fact-confirm').check();assert.equal(await taxProfile.getByTestId('tax-fact-submit').isEnabled(),true);await page.getByTestId('tax-profile-jurisdiction').selectOption('scotland');assert.equal(await taxProfile.getByTestId('tax-fact-confirm').isChecked(),false);
  await page.getByTestId('tax-input-label').fill('Synthetic employment');await page.getByTestId('tax-input-taxable_pay_pence').fill('14033.52');await page.getByTestId('tax-input-income_tax_withheld_pence').fill('1542.60');await page.getByTestId('tax-input-statement_basis').selectOption('p45_current_employment');await page.getByTestId('tax-input-period_start').fill('2025-04-06');await page.getByTestId('tax-input-period_end').fill('2026-04-05');await page.getByTestId('tax-input-state').selectOption('verified');assert.equal(await taxInput.getByTestId('tax-fact-confirm').isDisabled(),true);
  await page.getByTestId('tax-input-document_ids').selectOption(['tax-doc']);await page.getByTestId('tax-input-reason').fill('Read back synthetic evidence');const taxCopy=await page.getByTestId('tax-input-readback').innerText();assert.ok(taxCopy.includes('£14,033.52'));assert.ok(taxCopy.includes('fourteen thousand thirty-three pounds and fifty-two pence'));assert.ok(taxCopy.includes('Unknown'));assert.ok(taxCopy.includes('£0.00'));
  await taxInput.getByTestId('tax-fact-confirm').check();assert.equal(await taxInput.getByTestId('tax-fact-submit').isEnabled(),true);const typedTax=JSON.parse(await taxInput.locator('input[name="review"]').inputValue());assert.equal(typedTax.data.taxable_pay_pence,1403352);assert.equal(typedTax.data.class1_band_earnings_pence,null);
  await page.getByTestId('tax-input-taxable_pay_pence').fill('0.00');assert.equal(await taxInput.getByTestId('tax-fact-confirm').isChecked(),false);await taxInput.getByTestId('tax-fact-confirm').check();await page.getByTestId('tax-input-document_ids').selectOption([]);assert.equal(await taxInput.getByTestId('tax-fact-confirm').isChecked(),false);assert.equal(await taxInput.getByTestId('tax-fact-confirm').isDisabled(),true);await page.getByTestId('tax-input-document_ids').selectOption(['tax-doc']);await taxInput.getByTestId('tax-fact-confirm').check();
  await page.getByTestId('tax-section-verdict').selectOption('complete');assert.equal(await taxSection.getByTestId('tax-fact-confirm').isDisabled(),true);await page.getByTestId('tax-section-verdict').selectOption('none');await page.getByTestId('tax-section-reason').fill('Confirmed no contributions in this year');await taxSection.getByTestId('tax-fact-confirm').check();assert.equal(await taxSection.getByTestId('tax-fact-submit').isEnabled(),true);
  await taxProfile.getByTestId('tax-fact-confirm').check();await page.getByTestId('tax-new-snapshot').click();assert.equal(await taxProfile.getByTestId('tax-fact-confirm').isChecked(),false);assert.equal(await taxInput.getByTestId('tax-fact-confirm').isChecked(),false);assert.equal(await taxSection.getByTestId('tax-fact-confirm').isChecked(),false);
  await page.getByTestId('tax-load-edit').click();await page.getByTestId('tax-input-taxable_pay_pence').fill('99.00');await page.getByTestId('tax-input-state').selectOption('withdrawn');assert.equal(await page.getByTestId('tax-input-taxable_pay_pence').isDisabled(),true);assert.equal(await page.getByTestId('tax-input-taxable_pay_pence').inputValue(),'14033.52');const withdrawal=JSON.parse(await taxInput.locator('input[name="review"]').inputValue());assert.equal(withdrawal.state,'withdrawn');assert.equal(withdrawal.data.taxable_pay_pence,1403352);assert.deepEqual(withdrawal.document_ids,['tax-doc']);assert.ok((await page.getByTestId('tax-input-readback').innerText()).includes('Earlier approved values are not restored'));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: CSV/document gates; mixed-use, allocations, transfers refunds, credits, returned-cash assignments duplicate verdicts evidence recovery, merchant decisions and reviewed tax facts read back exact effects and reset confirmation on changed review state.",
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
