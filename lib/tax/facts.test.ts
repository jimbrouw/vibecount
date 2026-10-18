import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  emptyProfile,
  parseFactInputs,
  validateFact,
  validateProfile,
} from "./facts.ts";
import { taxFactManifest } from "./fact-export.ts";
const employment = {
  taxable_pay_pence: 1403352,
  income_tax_withheld_pence: 154260,
  class1_band_earnings_pence: null,
  statement_basis: "p45_current_employment",
  period_start: "2025-04-06",
  period_end: "2026-04-05",
};
test("tax facts keep missing, reviewed zero and exact signed values distinct at year boundaries", () => {
  const parsed = parseFactInputs(
    "employment",
    {
      taxable_pay_pence: "14033.52",
      income_tax_withheld_pence: "-1.01",
      class1_band_earnings_pence: "",
      statement_basis: "p45_current_employment",
      period_start: "2025-04-06",
      period_end: "2026-04-05",
    },
    2025,
    "verified",
  );
  assert.equal(parsed.taxable_pay_pence, 1403352);
  assert.equal(parsed.income_tax_withheld_pence, -101);
  assert.equal(parsed.class1_band_earnings_pence, null);
  assert.equal(
    validateFact(
      "employment",
      { ...employment, taxable_pay_pence: 0 },
      2025,
      "verified",
    ).taxable_pay_pence,
    0,
  );
  assert.throws(
    () =>
      validateFact(
        "employment",
        { ...employment, taxable_pay_pence: null },
        2025,
      ),
    /Missing/,
  );
  assert.throws(
    () =>
      validateFact(
        "employment",
        { ...employment, period_end: "2026-04-06" },
        2025,
      ),
    /selected tax year/,
  );
  assert.throws(
    () =>
      validateFact(
        "employment",
        { ...employment, period_start: "2025-02-30" },
        2025,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateFact(
        "employment",
        { ...employment, object_path: "private" },
        2025,
      ),
    /Unexpected/,
  );
});
test("profile completeness is an explicit answer; unknown jurisdiction and basis cannot become reviewed", () => {
  assert.equal(validateProfile(emptyProfile()).accounting_basis, "unknown");
  assert.throws(() => validateProfile(emptyProfile(), true), /provisional/);
  assert.throws(
    () => validateProfile({ ...emptyProfile(), paye: 0 }),
    /every explicit/,
  );
});
test("pension assets, unsupported bicycle mileage, unreviewed exemptions and oversized payment credits do not become verified facts", () => {
  const pension = {
    net_paid_pence: 400000,
    gross_contribution_pence: 500000,
    method: "unknown",
    period_start: "2025-04-06",
    period_end: "2026-04-05",
  };
  assert.throws(
    () => validateFact("pension", pension, 2025, "verified"),
    /Resolve/,
  );
  assert.throws(
    () =>
      validateFact("pension", { ...pension, pension_savings: 4305500 }, 2025),
    /Unexpected/,
  );
  assert.throws(
    () =>
      validateFact(
        "vehicle",
        {
          vehicle_type: "bicycle",
          method: "simplified_mileage",
          business_use_bps: 4500,
          business_miles_hundredths: 10000,
          period_start: "2025-04-06",
          period_end: "2026-04-05",
        },
        2025,
        "verified",
      ),
    /Employee bicycle/,
  );
  assert.throws(
    () =>
      validateFact(
        "termination",
        {
          gross_pence: 1025525,
          taxable_pence: 0,
          income_tax_withheld_pence: 0,
          payment_date: "2025-08-01",
          treatment: "unresolved",
        },
        2025,
        "verified",
      ),
    /Resolve/,
  );
  assert.throws(
    () =>
      validateFact(
        "tax_payment",
        {
          payment_reference: "Synthetic statement item",
          paid_total_pence: 10000,
          allocated_pence: 10001,
          allocation_type: "balancing_payment",
          payment_date: "2027-01-31",
        },
        2025,
      ),
    /allocation/,
  );
});
test("fact history exports retain source hashes without private document coordinates and are independently hashable", () => {
  const source = {
    id: "source",
    revision_id: "revision",
    document_id: "doc",
    transaction_id: null,
    record_id: null,
    snapshot: {
      id: "doc",
      file_sha256: "a".repeat(64),
      media_type: "application/pdf",
      size_bytes: 100,
      object_path: "PRIVATE_PATH",
      key_id: "PRIVATE_KEY",
      original_name: "PRIVATE_NAME",
    },
  };
  const data = {
    profiles: [],
    facts: [
      {
        id: "revision",
        schema_version: "tax-facts/1",
        kind: "employment",
        state: "verified",
        data: employment,
      },
    ],
    sources: [source],
    sections: [],
  };
  const result = taxFactManifest(2025, data),
    serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("PRIVATE_"));
  assert.equal(result.snapshot.sources[0].snapshot.file_sha256, "a".repeat(64));
  assert.equal(
    result.snapshot_sha256,
    createHash("sha256").update(JSON.stringify(result.snapshot)).digest("hex"),
  );
  assert.match(result.document_status, /not submitted/);
  assert.throws(
    () =>
      taxFactManifest(2025, {
        ...data,
        sources: [{ ...source, snapshot: { id: "doc" } }],
      }),
    /hash unavailable/,
  );
});
