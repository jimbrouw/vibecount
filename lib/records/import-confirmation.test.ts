import assert from "node:assert/strict";
import test from "node:test";
import { readImportConfirmation } from "./import-confirmation.ts";

test("confirmation requires explicit consent, distinct exact IDs and review versions", () => {
  const row = { id: "11111111-1111-1111-1111-111111111111", updated_at: "2026-10-17T10:00:00.000Z" };
  const form = new FormData();
  form.set("reviewedRows", JSON.stringify([row]));
  assert.equal(readImportConfirmation(form), null);
  form.set("humanConfirmed", "yes");
  assert.deepEqual(readImportConfirmation(form), [row]);
  for (const value of [[row, row], [{ id: row.id }], [], [{ ...row, id: "other" }], [{ ...row, updated_at: "invalid" }]]) {
    form.set("reviewedRows", JSON.stringify(value));
    assert.equal(readImportConfirmation(form), null);
  }
});
