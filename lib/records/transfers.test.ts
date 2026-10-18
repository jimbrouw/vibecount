import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  readSourceCsv,
  normalizeSourceCsv,
  suggestMapping,
} from "./source-csv.ts";
import { transferReview, type TransferChoice } from "./transfers.ts";
const out: TransferChoice = {
  id: "out",
  account_id: "bank1",
  import_id: "source1",
  transaction_date: "2026-04-05",
  signed_amount_pence: -63029,
  currency: "GBP",
  description: "Synthetic",
  account_label: "Bank",
  account_mask: "1234",
  account_type: "bank",
  classification: "Mixed",
  decision_version: 1,
  dedupe_status: "clear",
  active_transfer_id: null,
  import_status: "review",
  record_status: "approved",
  recognized_pence: 18909,
  invoice_allocated_pence: 0,
};
const inc: TransferChoice = {
  ...out,
  id: "in",
  account_id: "bank2",
  import_id: "source2",
  signed_amount_pence: 63029,
  recognized_pence: 63029,
};
test("committed synthetic bank/card fixtures normalize repayment directions without deducting purchases twice", async () => {
  const parsed = await Promise.all(
    ["nationwide", "starling", "amex"].map(async (provider) => {
      const table = readSourceCsv(
        await readFile(
          new URL(
            `../../fixtures/synthetic-transfer-${provider}.csv`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      return normalizeSourceCsv(table, suggestMapping(table[0], provider));
    }),
  );
  assert.equal(parsed[0][0].signedPence, -150000);
  assert.equal(parsed[1][0].signedPence, 150000);
  assert.equal(parsed[0][1].signedPence, -30000);
  assert.equal(parsed[2][0].signedPence, 30000);
  assert.equal(parsed[2][1].signedPence, -63029);
});
test("transfer read-back uses exact current posting effects without touching separate card purchases", () => {
  assert.deepEqual(transferReview(out, inc, "transfer"), {
    amount: 63029,
    removedIncome: 63029,
    removedExpense: 18909,
  });
  assert.equal(
    transferReview(
      out,
      { ...inc, account_type: "credit_card" },
      "card_repayment",
    ).amount,
    63029,
  );
});
test("transfer preview hard-stops mismatched, paired, duplicate, reversed and invoice-allocated sources", () => {
  for (const changed of [
    { account_id: out.account_id },
    { signed_amount_pence: 63028 },
    { currency: "EUR" },
    { active_transfer_id: "existing" },
    { dedupe_status: "needs_review" },
    { import_status: "discarded" },
    { invoice_allocated_pence: 1 },
  ])
    assert.throws(() =>
      transferReview(out, { ...inc, ...changed }, "transfer"),
    );
  assert.throws(() => transferReview(out, inc, "card_repayment"));
});
