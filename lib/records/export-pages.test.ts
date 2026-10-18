import assert from "node:assert/strict";
import test from "node:test";
import { readAllExportRows } from "./export-pages.ts";

test("exports continue past a short server-capped page without losing rows", async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: String(i).padStart(8, "0") }));
  let pages = 0;
  const result = await readAllExportRows(async (after) => {
    pages++;
    return { data: rows.filter((r) => after === null || r.id > after).slice(0, 173), error: null };
  });
  assert.deepEqual(result, rows);
  assert.equal(pages, 8);
});

test("failed pages or non-advancing results fail the whole export", async () => {
  await assert.rejects(readAllExportRows(async (after) => after
    ? { data: null, error: new Error("database unavailable") }
    : { data: [{ id: "a" }], error: null }), /complete export/);
  await assert.rejects(readAllExportRows(async () => ({ data: [{ id: "a" }], error: null })), /did not advance/);
});
