import test from "node:test";
import assert from "node:assert/strict";
import { redactBankDetailsForPrompt } from "./redaction.ts";

test("redacts common UK bank identifiers before prompt construction", () => {
  const result = redactBankDetailsForPrompt(
    "Paid from sort code 12-34-56 account 12345678 and IBAN GB29 NWBK 6016 1331 9268 19"
  );

  assert.equal(result.includes("12-34-56"), false);
  assert.equal(result.includes("12345678"), false);
  assert.equal(result.includes("GB29"), false);
  assert.match(result, /\[redacted sort code\]/);
  assert.match(result, /\[redacted account number\]/);
  assert.match(result, /\[redacted IBAN\]/);
});
