import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("reconciliation actions enforce confirmation/auth and pass exact reviewed state to their distinct RPCs", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents:
        "export * from './app/dashboard/reconciliation/actions.ts';export * from './app/dashboard/reconciliation/transfers/actions.ts';export * from './app/dashboard/reconciliation/refunds/actions.ts';export * from './app/dashboard/reconciliation/refund-assignments/actions.ts';export * from './app/dashboard/reconciliation/duplicates/actions.ts';export * from './app/dashboard/imports/recovery/actions.ts';export * from './app/dashboard/review/memory/actions.ts';export * from './app/dashboard/tax-prep/facts/actions.ts';export {fixture} from 'test:db';",
    },
    plugins: [
      {
        name: "isolated-action-transport",
        setup(builder) {
          builder.onResolve(
            { filter: /^(@\/lib\/supabase\/server|test:db)$/ },
            () => ({ path: "db", namespace: "test-fixture" }),
          );
          builder.onResolve(
            { filter: /^next\/(cache|navigation)$/ },
            (args) => ({ path: args.path, namespace: "test-fixture" }),
          );
          builder.onResolve(
            { filter: /^@\/lib\/records\/recovery-store$/ },
            () => ({ path: "recovery", namespace: "recovery-fixture" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "recovery-fixture" },
            () => ({
              loader: "js",
              contents:
                "import {fixture} from 'test:db';export async function recoverEvidenceAttempt(args){fixture.calls.push({name:'recovery',args});return {import_id:'saved'}}",
            }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "test-fixture" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "db"
                  ? `export const fixture={signedIn:true,calls:[]};export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},from(name){if(!['refund_requests','invoice_refund_requests'].includes(name))throw new Error('Unexpected history table');const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{request_id:'retained'},error:null}}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});return {error:null}}}}`
                  : args.path === "next/cache"
                    ? "export function revalidatePath(){}"
                    : "export function redirect(path){throw new Error('REDIRECT:'+path)}",
            }),
          );
        },
      },
    ],
  });
  const actionModule = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64")
  );
  const transaction = "11111111-1111-4111-8111-111111111111",
    invoice = "22222222-2222-4222-8222-222222222222",
    request = "33333333-3333-4333-8333-333333333333";
  const form = new FormData();
  form.set("transactionId", transaction);
  form.set("version", "1");
  form.set("expectedAllocated", "50000");
  form.set("requestId", request);
  form.set("reason", "Reviewed exact receipt");
  form.set(
    "allocations",
    JSON.stringify([
      {
        invoice_id: invoice,
        amount_pence: 25000,
        invoice_updated_at: "2026-01-01T00:00:00Z",
      },
    ]),
  );
  await assert.rejects(
    actionModule.approveAllocations(form),
    /Review%20the%20exact/,
  );
  assert.equal(actionModule.fixture.calls.length, 0);
  form.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.approveAllocations(form),
    /result=allocated/,
  );
  assert.deepEqual(actionModule.fixture.calls[0], {
    name: "approve_invoice_allocations",
    args: {
      p_transaction: transaction,
      p_version: 1,
      p_allocations: [
        {
          invoice_id: invoice,
          amount_pence: 25000,
          invoice_updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      p_reason: "Reviewed exact receipt",
      p_request: request,
      p_expected_allocated: 50000,
    },
  });
  const reversal = new FormData();
  reversal.set("allocationId", invoice);
  reversal.set("requestId", request);
  reversal.set("reason", "Reverse wrong invoice");
  reversal.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.reverseAllocation(reversal),
    /result=reversed/,
  );
  assert.deepEqual(actionModule.fixture.calls[1], {
    name: "reverse_invoice_allocation",
    args: {
      p_allocation: invoice,
      p_reason: "Reverse wrong invoice",
      p_request: request,
    },
  });
  actionModule.fixture.signedIn = false;
  await assert.rejects(actionModule.approveAllocations(form), /login/);
  await assert.rejects(actionModule.reverseAllocation(reversal), /login/);
  assert.equal(actionModule.fixture.calls.length, 2);
  actionModule.fixture.signedIn = true;
  const transfer = new FormData();
  transfer.set("outgoing", transaction);
  transfer.set("incoming", invoice);
  transfer.set("outgoingVersion", "0");
  transfer.set("incomingVersion", "1");
  transfer.set("kind", "card_repayment");
  transfer.set("requestId", request);
  transfer.set("reason", "Checked both sources");
  await assert.rejects(actionModule.approveTransfer(transfer), /Review%20both/);
  assert.equal(actionModule.fixture.calls.length, 2);
  transfer.set("humanConfirmed", "yes");
  await assert.rejects(actionModule.approveTransfer(transfer), /result=paired/);
  assert.deepEqual(actionModule.fixture.calls[2], {
    name: "approve_transfer_pair",
    args: {
      p_outgoing: transaction,
      p_outgoing_version: 0,
      p_incoming: invoice,
      p_incoming_version: 1,
      p_kind: "card_repayment",
      p_reason: "Checked both sources",
      p_request: request,
    },
  });
  const reversePair = new FormData();
  reversePair.set("pairId", invoice);
  reversePair.set("requestId", request);
  reversePair.set("reason", "Wrong pair");
  reversePair.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.reverseTransfer(reversePair),
    /result=reversed/,
  );
  assert.deepEqual(actionModule.fixture.calls[3], {
    name: "reverse_transfer_pair",
    args: { p_pair: invoice, p_reason: "Wrong pair", p_request: request },
  });
  actionModule.fixture.signedIn = false;
  await assert.rejects(actionModule.approveTransfer(transfer), /login/);
  await assert.rejects(actionModule.reverseTransfer(reversePair), /login/);
  assert.equal(actionModule.fixture.calls.length, 4);
  actionModule.fixture.signedIn = true;
  const refundForm = new FormData();
  refundForm.set("original", transaction);
  refundForm.set("refund", invoice);
  refundForm.set("requestId", request);
  refundForm.set("originalVersion", "1");
  refundForm.set("refundVersion", "0");
  refundForm.set("stamp", "a".repeat(32));
  refundForm.set("reason", "Verified both sources");
  const beforeRefund = actionModule.fixture.calls.length;
  await assert.rejects(
    actionModule.approveRefund(refundForm),
    /Review%20the%20complete/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeRefund);
  refundForm.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.approveRefund(refundForm),
    /result=approved/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "approve_refund",
    args: {
      p_original: transaction,
      p_original_version: 1,
      p_refund: invoice,
      p_refund_version: 0,
      p_stamp: "a".repeat(32),
      p_reason: "Verified both sources",
      p_request: request,
    },
  });
  await assert.rejects(
    actionModule.reverseRefundGroup(refundForm),
    /result=reversed/,
  );
  assert.equal(actionModule.fixture.calls.at(-1).name, "reverse_refund_group");
  actionModule.fixture.signedIn = false;
  const beforeDenied = actionModule.fixture.calls.length;
  await assert.rejects(actionModule.approveRefund(refundForm), /login/);
  await assert.rejects(actionModule.reverseRefundGroup(refundForm), /login/);
  assert.equal(actionModule.fixture.calls.length, beforeDenied);
  const assignment = new FormData();
  assignment.set("creditId", invoice);
  assignment.set("allocationId", transaction);
  assignment.set("refundId", request);
  assignment.set("requestId", request);
  assignment.set("amount", "30.00");
  assignment.set("stamp", "b".repeat(32));
  assignment.set("reason", "Reviewed returned cash");
  await assert.rejects(actionModule.approveInvoiceRefund(assignment), /login/);
  actionModule.fixture.signedIn = true;
  await assert.rejects(
    actionModule.approveInvoiceRefund(assignment),
    /Review%20the%20exact/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeDenied);
  assignment.set("humanConfirmed", "yes");
  assignment.set("amount", "30.001");
  await assert.rejects(
    actionModule.approveInvoiceRefund(assignment),
    /positive%20exact/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeDenied);
  assignment.set("amount", "30.00");
  await assert.rejects(
    actionModule.approveInvoiceRefund(assignment),
    /result=assigned/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "approve_invoice_refund_assignment",
    args: {
      p_credit: invoice,
      p_allocation: transaction,
      p_refund: request,
      p_amount: 3000,
      p_stamp: "b".repeat(32),
      p_reason: "Reviewed returned cash",
      p_request: request,
    },
  });
  assignment.set("assignmentId", invoice);
  await assert.rejects(
    actionModule.reverseInvoiceRefund(assignment),
    /result=reversed/,
  );
  assert.equal(
    actionModule.fixture.calls.at(-1).name,
    "reverse_invoice_refund_assignment",
  );
  actionModule.fixture.signedIn = false;
  await assert.rejects(actionModule.reverseInvoiceRefund(assignment), /login/);
  const identity = new FormData();
  identity.set("transaction", transaction);
  identity.set("requestId", request);
  identity.set("stamp", "c".repeat(32));
  identity.set("verdict", "duplicate");
  identity.set("retained", invoice);
  identity.set("reason", "Checked source identity");
  const identityBefore = actionModule.fixture.calls.length;
  await assert.rejects(actionModule.approveDuplicate(identity), /login/);
  actionModule.fixture.signedIn = true;
  await assert.rejects(
    actionModule.approveDuplicate(identity),
    /Review%20the%20complete/,
  );
  assert.equal(actionModule.fixture.calls.length, identityBefore);
  identity.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.approveDuplicate(identity),
    /result=approved/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "approve_duplicate_decision",
    args: {
      p_transaction: transaction,
      p_retained: invoice,
      p_verdict: "duplicate",
      p_stamp: "c".repeat(32),
      p_reason: "Checked source identity",
      p_request: request,
    },
  });
  identity.set("decision", request);
  await assert.rejects(
    actionModule.reverseDuplicate(identity),
    /result=reversed/,
  );
  assert.equal(
    actionModule.fixture.calls.at(-1).name,
    "reverse_duplicate_decision",
  );
  const identitiesSent = actionModule.fixture.calls.length;
  identity.set("verdict", "distinct");
  await assert.rejects(
    actionModule.approveDuplicate(identity),
    /Choose%20whether/,
  );
  assert.equal(actionModule.fixture.calls.length, identitiesSent);
  actionModule.fixture.signedIn = false;
  await assert.rejects(actionModule.reverseDuplicate(identity), /login/);
  const recovery = new FormData();
  recovery.set("kind", "source");
  recovery.set("attempt", transaction);
  recovery.set("stamp", "d".repeat(32));
  recovery.set("requestId", request);
  recovery.set("reason", "Verified preservation retry");
  await assert.rejects(actionModule.recoverUpload(recovery), /login/);
  actionModule.fixture.signedIn = true;
  const beforeRecovery = actionModule.fixture.calls.length;
  await assert.rejects(
    actionModule.recoverUpload(recovery),
    /Review%20the%20preserved/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeRecovery);
  recovery.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.recoverUpload(recovery),
    /result=recovered/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "recovery",
    args: {
      owner: "owner",
      kind: "source",
      attempt: transaction,
      stamp: "d".repeat(32),
      request,
      reason: "Verified preservation retry",
    },
  });
  actionModule.fixture.signedIn = false;
  await assert.rejects(actionModule.recoverUpload(recovery), /login/);
  const memory = new FormData();
  memory.set("stamp", "e".repeat(32));
  memory.set("requestId", request);
  memory.set("reason", "Reviewed merchant scope");
  memory.set(
    "entries",
    JSON.stringify([
      {
        transaction_id: transaction,
        version: 7,
        origin: "manual",
        classification: "Personal",
        business_use_bps: 0,
        category_id: null,
        evidence_status: "missing",
        document_ids: [],
      },
    ]),
  );
  const beforeMemory = actionModule.fixture.calls.length;
  await assert.rejects(actionModule.approveMerchantBatch(memory), /login/);
  actionModule.fixture.signedIn = true;
  await assert.rejects(
    actionModule.approveMerchantBatch(memory),
    /Review%20the%20full/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeMemory);
  memory.set("humanConfirmed", "yes");
  memory.set("reviewYear", "2026");
  await assert.rejects(
    actionModule.approveMerchantBatch(memory),
    /result=batch-approved&year=2026/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "approve_merchant_batch",
    args: {
      p_entries: JSON.parse(String(memory.get("entries"))),
      p_stamp: "e".repeat(32),
      p_reason: "Reviewed merchant scope",
      p_request: request,
    },
  });
  memory.set(
    "definition",
    JSON.stringify({ seed_id: transaction, classification: "Personal" }),
  );
  memory.set("version", "0");
  await assert.rejects(
    actionModule.saveMerchantRule(memory),
    /result=rule-saved/,
  );
  assert.equal(actionModule.fixture.calls.at(-1).name, "save_merchant_rule");
  memory.set("batchId", invoice);
  await assert.rejects(
    actionModule.undoMerchantBatch(memory),
    /result=batch-reversed/,
  );
  assert.equal(
    actionModule.fixture.calls.at(-1).name,
    "reverse_merchant_batch",
  );
  const tax = new FormData();
  tax.set("year", "2025");
  tax.set("stamp", "f".repeat(32));
  tax.set("requestId", request);
  tax.set("reason", "Reviewed synthetic tax-year profile");
  const taxReview = {
    action: "profile",
    expected_ordinal: 0,
    state: "provisional",
    data: {
      jurisdiction: "unknown",
      accounting_basis: "unknown",
      business_structure: "unknown",
      vat_registered: "unknown",
      student_loan: "unknown",
      residency: "unknown",
      special_reliefs: "unknown",
      ledger_completeness: "unreviewed",
    },
  };
  tax.set("review", JSON.stringify(taxReview));
  actionModule.fixture.signedIn = false;
  const beforeTax = actionModule.fixture.calls.length;
  await assert.rejects(actionModule.reviewTaxInputs(tax), /login/);
  actionModule.fixture.signedIn = true;
  await assert.rejects(
    actionModule.reviewTaxInputs(tax),
    /Review%20the%20complete/,
  );
  assert.equal(actionModule.fixture.calls.length, beforeTax);
  tax.set("humanConfirmed", "yes");
  await assert.rejects(
    actionModule.reviewTaxInputs(tax),
    /year=2025&result=saved/,
  );
  assert.deepEqual(actionModule.fixture.calls.at(-1), {
    name: "review_tax_inputs",
    args: {
      p_year: 2025,
      p_review: taxReview,
      p_stamp: "f".repeat(32),
      p_reason: "Reviewed synthetic tax-year profile",
      p_request: request,
    },
  });
  taxReview.state = "reviewed";
  tax.set("review", JSON.stringify(taxReview));
  const sentTax = actionModule.fixture.calls.length;
  await assert.rejects(
    actionModule.reviewTaxInputs(tax),
    /missing%20and%20invalid/,
  );
  assert.equal(actionModule.fixture.calls.length, sentTax);
});
