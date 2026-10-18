// Synthetic invoice component proof; no financial API or external service is called.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  stdin: {
    resolveDir: process.cwd(),
    loader: "jsx",
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import InvoiceBuilder from './app/dashboard/invoices/new/InvoiceBuilder.tsx';
const defaults={legal_name:'Synthetic freelancer',address:'',contact_details:'',default_payment_terms:'30 days',bank_details:'',payment_link_provider:'',payment_link_url:'',vat_registered:true,vat_number:'GB-NEW-DEFAULT',vat_rate:25,invoice_number_prefix:'SYNTHETIC',late_payment_wording:'',hasSettings:true,companiesHouseConfigured:false};
const draft={clientName:'Synthetic client',description:'Synthetic work',source:'edit',transcript:'',clientAddress:'',clientCompanyNumber:'',invoiceId:'11111111-1111-4111-8111-111111111111',expectedUpdated:'2026-01-01T00:00:00Z'};
createRoot(document.getElementById('root')).render(<><section id="saved"><InvoiceBuilder existingClients={[]} initialDate="05/04/2026" userDefaults={defaults} initialDraft={{...draft,amount:'100.00',vatEnabled:true,vatRate:'20',vatNumber:'GB-ORIGINAL'}}/></section><section id="legacy"><InvoiceBuilder existingClients={[]} initialDate="05/04/2026" userDefaults={defaults} initialDraft={{...draft,amount:'',legacyGrossPence:12000,vatEnabled:false,vatRate:'',vatNumber:''}}/></section></>);`,
  },
  plugins: [
    {
      name: "inert-invoice-services",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(next\/link|@\/lib\/analytics|@\/app\/dashboard\/(AccessibilityProvider|ExplainTerm|ReadAloudButton|invoices\/actions))$/,
          },
          (args) => ({ path: args.path, namespace: "inert" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "inert" }, (args) => ({
          loader: "jsx",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/link"
              ? `import React from 'react';export default function Link(p){return <a {...p}/>}`
              : args.path.endsWith("AccessibilityProvider")
                ? "export function useAccessibility(){return {plainLanguage:false}}"
                : args.path.endsWith("ExplainTerm")
                  ? "export default function ExplainTerm(p){return p.children}"
                  : args.path.endsWith("ReadAloudButton")
                    ? "export default function ReadAloudButton(){return null}"
                    : args.path.endsWith("actions")
                      ? "export async function enableInvoiceReminders(){};export async function markInvoiceSent(){}"
                      : "export function trackEvent(){}",
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.VIBECOUNT_TEST_BROWSER ||
      (existsSync(chrome) ? chrome : undefined),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.invoiceRequests = [];
    window.fetch = async (url, init) => {
      window.invoiceRequests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ error: "Synthetic transport: nothing saved" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const saved = page.locator("#saved");
  assert.match(await saved.innerText(), /£120\.00/);
  assert.equal(
    await saved.getByTestId("invoice-vat-toggle").isDisabled(),
    true,
  );
  assert.equal(
    await saved.getByTestId("invoice-confirm-download-button").isDisabled(),
    true,
  );
  await saved
    .getByTestId("invoice-revision-reason")
    .fill("Verified same invoice");
  await saved.getByTestId("invoice-confirm-review").check();
  await saved.locator('input[name="amount"]').fill("200.00");
  assert.equal(
    await saved.getByTestId("invoice-confirm-review").isChecked(),
    false,
  );
  assert.match(await saved.innerText(), /£240\.00/);
  await saved.getByTestId("invoice-confirm-review").check();
  await saved.getByTestId("invoice-confirm-download-button").click();
  await page.waitForFunction(() => window.invoiceRequests.length === 1);
  const payload = await page.evaluate(() => window.invoiceRequests[0]);
  assert.equal(payload.amount, "200.00");
  assert.equal(payload.vatPence, 4000);
  assert.equal(payload.vatRate, "20");
  assert.equal(payload.vatNumber, "GB-ORIGINAL");
  assert.equal(payload.humanConfirmed, true);
  const legacy = page.locator("#legacy");
  assert.equal(await legacy.locator('input[name="amount"]').inputValue(), "");
  assert.match(await legacy.innerText(), /original total is £120\.00/);
  await legacy
    .getByTestId("invoice-revision-reason")
    .fill("Checked original PDF");
  await legacy.locator('input[name="amount"]').fill("100.00");
  await legacy.getByTestId("invoice-vat-toggle").check();
  await legacy.getByTestId("invoice-legacy-vat-rate").fill("20");
  await legacy.getByTestId("invoice-legacy-vat-number").fill("GB-LEGACY");
  await legacy.getByTestId("invoice-legacy-confirm").check();
  await legacy.getByTestId("invoice-confirm-review").check();
  assert.equal(
    await legacy.getByTestId("invoice-confirm-download-button").isDisabled(),
    false,
  );
  await legacy.locator('input[name="amount"]').fill("120.00");
  assert.equal(
    await legacy.getByTestId("invoice-legacy-confirm").isChecked(),
    false,
  );
  assert.equal(
    await legacy.getByTestId("invoice-confirm-download-button").isDisabled(),
    true,
  );
  assert.match(await legacy.innerText(), /must equal the original total/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: saved VAT survives changed defaults, edits reset approval, legacy amounts require verified original totals, and requests carry the reviewed economics.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
