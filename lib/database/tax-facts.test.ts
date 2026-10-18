import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
import { emptyProfile, type FactKind } from "../tax/facts.ts";

test("reviewed tax inputs preserve source evidence, missing states and zero trading effects", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const n of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(n, dir), "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  async function auth(user: string | null = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? "",
    ]);
    await db.exec(user ? "set role authenticated" : "set role anon");
  }
  async function document(user = owner) {
    await db.exec("reset role");
    const id = (
      await db.query<{ id: string }>(
        "insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,$3,'test') returning id",
        [user, randomBytes(32).toString("hex"), user + "/" + randomUUID()],
      )
    ).rows[0].id;
    await auth();
    return id;
  }
  const doc = await document(),
    foreignDoc = await document(other);
  const stamp = async (year = 2025) =>
    (await db.query<{ s: string }>("select tax_review_stamp($1) s", [year]))
      .rows[0].s;
  async function save(
    review: Record<string, unknown>,
    year = 2025,
    s?: string,
    request = randomUUID(),
  ) {
    return (
      await db.query<{
        r: {
          revision_id: string;
          family_id: string;
          ordinal: number;
          new_postings: number;
        };
      }>(
        "select review_tax_inputs($1,$2,$3,'Reviewed synthetic tax evidence',$4) r",
        [year, JSON.stringify(review), s ?? (await stamp(year)), request],
      )
    ).rows[0].r;
  }
  const facts = async (year = 2025) =>
    (
      await db.query<{
        id: string;
        family_id: string;
        kind: FactKind;
        ordinal: number;
        state: string;
        data: Record<string, unknown>;
      }>("select * from current_tax_facts where tax_year_start=$1", [year])
    ).rows;
  const employment = {
    taxable_pay_pence: 1403352,
    income_tax_withheld_pence: 154260,
    class1_band_earnings_pence: null,
    statement_basis: "p45_current_employment",
    period_start: "2025-04-06",
    period_end: "2026-04-05",
  };
  function fact(
    kind: FactKind,
    label: string,
    data: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    return {
      action: "fact",
      family_id: null,
      expected_ordinal: 0,
      kind,
      label,
      state: "verified",
      data,
      document_ids: [doc],
      transaction_ids: [],
      record_ids: [],
      ...extra,
    };
  }
  await serialSubtest(t,
    "profile review is explicit, versioned, year-isolated, stale guarded and safely replayable",
    async () => {
      const review = {
          action: "profile",
          expected_ordinal: 0,
          state: "provisional",
          data: emptyProfile(),
        },
        s = await stamp(),
        request = randomUUID();
      const saved = await save(review, 2025, s, request);
      assert.equal(saved.new_postings, 0);
      assert.deepEqual(await save(review, 2025, s, request), saved);
      await assert.rejects(
        save({ ...review, state: "reviewed" }, 2025, undefined, request),
        /different tax review/,
      );
      await assert.rejects(
        save({ ...review, expected_ordinal: 1, state: "reviewed" }),
        /provisional/,
      );
      const data = {
        jurisdiction: "england_wales_ni",
        accounting_basis: "cash",
        business_structure: "sole_trader",
        vat_registered: "no",
        student_loan: "none",
        residency: "uk_full_year",
        special_reliefs: "none",
        ledger_completeness: "complete",
      };
      const current = await save({
        action: "profile",
        expected_ordinal: 1,
        state: "reviewed",
        data,
      });
      assert.equal(current.ordinal, 2);
      await assert.rejects(
        save({ ...review, expected_ordinal: 1 }),
        /revision changed/,
      );
      await assert.rejects(
        save({ ...review, expected_ordinal: 2 }, 2025, s),
        /inputs changed/,
      );
      assert.equal(
        (
          await db.query(
            "select * from current_tax_profiles where tax_year_start=2026",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "employment evidence, exact amounts, missing NI and section attestations never imply zero or duplicate postings",
    async () => {
      await assert.rejects(
        save({ action: "section", kind: "employment", verdict: "complete" }),
        /all provisional/,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", employment, {
            document_ids: [],
          }),
        ),
        /source evidence/,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", employment, {
            document_ids: [foreignDoc],
          }),
        ),
        /Owned active source/,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", {
            ...employment,
            raw_document: "private",
          }),
        ),
        /Unexpected/,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", {
            ...employment,
            taxable_pay_pence: 1.5,
          }),
        ),
        /exact value/,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", {
            ...employment,
            period_end: "2026-04-06",
          }),
        ),
        /selected tax year/,
      );
      const initial = await save(
        fact("employment", "Synthetic employer", employment, {
          state: "provisional",
        }),
      );
      await assert.rejects(
        save({ action: "section", kind: "employment", verdict: "none" }),
        /conflicts/,
      );
      await assert.rejects(
        save({ action: "section", kind: "employment", verdict: "complete" }),
        /provisional/,
      );
      const reviewed = await save(
        fact("employment", "Synthetic employer", employment, {
          family_id: initial.family_id,
          expected_ordinal: 1,
        }),
      );
      assert.equal(reviewed.ordinal, 2);
      await save({
        action: "section",
        kind: "employment",
        verdict: "complete",
      });
      assert.equal(
        (
          await db.query<{ is_current: boolean }>(
            "select is_current from current_tax_sections where kind='employment'",
          )
        ).rows[0].is_current,
        true,
      );
      const corrected = { ...employment, taxable_pay_pence: 0 };
      await save(
        fact("employment", "Synthetic employer", corrected, {
          family_id: initial.family_id,
          expected_ordinal: 2,
        }),
      );
      assert.equal((await facts())[0].data.taxable_pay_pence, 0);
      assert.equal(
        (
          await db.query<{ is_current: boolean }>(
            "select is_current from current_tax_sections where kind='employment'",
          )
        ).rows[0].is_current,
        false,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", employment, {
            family_id: initial.family_id,
            expected_ordinal: 3,
            state: "withdrawn",
          }),
        ),
        /retain exact/,
      );
      await save(
        fact("employment", "Synthetic employer", corrected, {
          family_id: initial.family_id,
          expected_ordinal: 3,
          state: "withdrawn",
        }),
      );
      await save({ action: "section", kind: "employment", verdict: "none" });
      assert.equal(
        (
          await db.query(
            "select * from tax_fact_history where kind='employment'",
          )
        ).rows.length,
        4,
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "pension methods and redundancy breakdown stay unresolved until reviewed evidence",
    async () => {
      const pension = {
        net_paid_pence: 400000,
        gross_contribution_pence: 500000,
        method: "unknown",
        period_start: "2025-04-06",
        period_end: "2026-04-05",
      };
      await assert.rejects(
        save(fact("pension", "Synthetic pension contributions", pension)),
        /Resolve tax treatment/,
      );
      await save(
        fact("pension", "Synthetic pension contributions", {
          ...pension,
          method: "relief_at_source",
        }),
      );
      await assert.rejects(
        save(
          fact("pension", "Invalid pension assets", {
            ...pension,
            pension_assets_pence: 4305500,
          }),
        ),
        /Unexpected/,
      );
      const termination = {
        gross_pence: 1025525,
        taxable_pence: 0,
        income_tax_withheld_pence: 0,
        payment_date: "2025-08-01",
        treatment: "unresolved",
      };
      await assert.rejects(
        save(fact("termination", "Synthetic settlement", termination)),
        /Resolve tax treatment/,
      );
      await save(
        fact("termination", "Synthetic settlement", termination, {
          state: "provisional",
        }),
      );
      assert.equal(
        (await facts()).find((f) => f.kind === "termination")?.state,
        "provisional",
      );
      await save({ action: "section", kind: "gift_aid", verdict: "none" });
    },
  );
  async function bank(amount = -10000, date = "2026-04-06") {
    await db.exec("reset role");
    const account = (
      await db.query<{ id: string }>(
        "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic tax bank','starling','bank','1234') returning id",
        [owner],
      )
    ).rows[0].id;
    const id = randomUUID(),
      hash = randomBytes(32).toString("hex"),
      path = owner + "/" + id;
    await db.query(
      "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'test',100,'uploaded')",
      [id, owner, account, hash, path],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
      [path],
    );
    await db.exec("set role service_role");
    const imp = (
      await db.query<{ r: { import_id: string } }>(
        "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",
        [
          owner,
          id,
          JSON.stringify([
            {
              row_number: 2,
              row_hash: hash,
              raw_encrypted: "synthetic",
              date,
              signed_pence: amount,
              currency: "GBP",
              description: "Synthetic tax source",
              reference: "Synthetic",
              fingerprint: hash,
            },
          ]),
        ],
      )
    ).rows[0].r.import_id;
    const tx = (
      await db.query<{ id: string }>(
        "select id from bank_transactions where import_id=$1",
        [imp],
      )
    ).rows[0].id;
    await auth();
    return tx;
  }
  await serialSubtest(t,
    "actual payment allocations are bounded across tax years and reserves are never inferred",
    async () => {
      const tx = await bank(),
        data = {
          payment_reference: "Synthetic statement item 3",
          paid_total_pence: 10000,
          allocated_pence: 6000,
          allocation_type: "first_payment_on_account",
          payment_date: "2026-04-06",
        };
      const one = await save(
        fact("tax_payment", "Payment allocation 2025", data, {
          document_ids: [],
          transaction_ids: [tx],
        }),
      );
      await assert.rejects(
        save(
          fact(
            "tax_payment",
            "Wrong total",
            { ...data, paid_total_pence: 20000 },
            { transaction_ids: [tx] },
          ),
        ),
        /Physical payment amount/,
      );
      await save(
        fact(
          "tax_payment",
          "Payment allocation 2026",
          {
            ...data,
            allocated_pence: 4000,
            allocation_type: "balancing_payment",
          },
          { transaction_ids: [tx] },
        ),
        2026,
      );
      await assert.rejects(
        save(
          fact(
            "tax_payment",
            "Over-allocation",
            { ...data, allocated_pence: 1 },
            { transaction_ids: [tx] },
          ),
        ),
        /already allocated/,
      );
      await assert.rejects(
        save(
          fact(
            "tax_payment",
            "Reserve cash",
            { ...data, allocated_pence: 1 },
            { document_ids: [] },
          ),
        ),
        /source evidence/,
      );
      await save(
        fact("tax_payment", "Payment allocation 2025", data, {
          family_id: one.family_id,
          expected_ordinal: 1,
          state: "withdrawn",
          document_ids: [],
          transaction_ids: [tx],
        }),
      );
      await save(
        fact(
          "tax_payment",
          "Reviewed remainder",
          { ...data, allocated_pence: 6000 },
          { transaction_ids: [tx] },
        ),
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "vehicle method and actual-cost provenance cannot silently double count across assets",
    async () => {
      await db.exec("reset role");
      const record = (
        await db.query<{ id: string }>(
          "insert into financial_records(user_id,record_type,record_date,description,amount,status) values ($1,'expense','2025-07-06','Synthetic vehicle repair',189.09,'approved') returning id",
          [owner],
        )
      ).rows[0].id;
      await auth();
      const data = {
        vehicle_type: "car",
        method: "actual_costs",
        business_use_bps: 3000,
        business_miles_hundredths: null,
        period_start: "2025-04-06",
        period_end: "2026-04-05",
      };
      await save(
        fact("vehicle", "Synthetic car", data, { record_ids: [record] }),
      );
      await assert.rejects(
        save(fact("vehicle", "Second asset", data, { record_ids: [record] })),
        /already belongs/,
      );
      await assert.rejects(
        save(
          fact("vehicle", "Synthetic bicycle", {
            ...data,
            vehicle_type: "bicycle",
            method: "simplified_mileage",
            business_miles_hundredths: 10000,
          }),
        ),
        /Employee bicycle/,
      );
      await assert.rejects(
        save(
          fact(
            "vehicle",
            "Missing mileage log",
            {
              ...data,
              method: "simplified_mileage",
              business_miles_hundredths: 10000,
            },
            { document_ids: [], record_ids: [record] },
          ),
        ),
        /source evidence/,
      );
    },
  );
  await serialSubtest(t,
    "linked non-trading sources keep their trading effect visible rather than removing it",
    async () => {
      const tx = await bank(50000, "2025-08-01");
      const category = (
        await db.query<{ id: string }>(
          "select id from record_categories where user_id is null and is_default and record_type='income' limit 1",
        )
      ).rows[0].id;
      await db.query(
        "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed synthetic receipt')",
        [tx, category],
      );
      const saved = await save(
        fact("employment", "Another synthetic employment", employment, {
          transaction_ids: [tx],
        }),
      );
      const overlap = (
        await db.query<{
          current_recognized_pence: string;
          source_unresolved: boolean;
        }>(
          "select * from tax_fact_source_status where revision_id=$1 and transaction_id=$2",
          [saved.revision_id, tx],
        )
      ).rows[0];
      assert.equal(Number(overlap.current_recognized_pence), 50000);
      assert.equal(overlap.source_unresolved, false);
    },
  );
  await serialSubtest(t,
    "stale sources can be withdrawn with their exact original provenance, without restoring earlier values",
    async () => {
      const tx = await bank(20000, "2025-09-01"),
        initial = await save(
          fact("employment", "Stale-source synthetic employment", employment, {
            transaction_ids: [tx],
          }),
        );
      const importId = (
        await db.query<{ import_id: string }>(
          "select import_id from bank_transactions where id=$1",
          [tx],
        )
      ).rows[0].import_id;
      await db.query(
        "select reverse_source_import($1,source_import_summary($1)->>'stamp','Reviewed source reversal')",
        [importId],
      );
      assert.equal(
        (
          await db.query<{ source_unresolved: boolean }>(
            "select source_unresolved from tax_fact_source_status where revision_id=$1 and transaction_id=$2",
            [initial.revision_id, tx],
          )
        ).rows[0].source_unresolved,
        true,
      );
      await assert.rejects(
        save(
          fact("employment", "Stale-source synthetic employment", employment, {
            family_id: initial.family_id,
            expected_ordinal: 1,
            state: "withdrawn",
            document_ids: [],
            transaction_ids: [tx],
          }),
        ),
        /exact prior source set/,
      );
      const withdrawn = await save(
        fact("employment", "Stale-source synthetic employment", employment, {
          family_id: initial.family_id,
          expected_ordinal: 1,
          state: "withdrawn",
          transaction_ids: [tx],
        }),
      );
      const snapshots = (
        await db.query<{ snapshot: unknown }>(
          "select snapshot from tax_fact_sources where revision_id=$1 order by id",
          [initial.revision_id],
        )
      ).rows
        .map((r) => JSON.stringify(r.snapshot))
        .sort();
      assert.deepEqual(
        (
          await db.query<{ snapshot: unknown }>(
            "select snapshot from tax_fact_sources where revision_id=$1",
            [withdrawn.revision_id],
          )
        ).rows
          .map((r) => JSON.stringify(r.snapshot))
          .sort(),
        snapshots,
      );
      const record = (
        await db.query<{ record_id: string }>(
          "select record_id from tax_fact_sources s join current_tax_facts v on v.id=s.revision_id where v.kind='vehicle' and record_id is not null limit 1",
        )
      ).rows[0].record_id;
      const vehicle = (await facts()).find((f) => f.kind === "vehicle")!;
      await db.exec("reset role");
      await db.query(
        "update financial_records set status='excluded' where id=$1",
        [record],
      );
      await auth();
      await save(
        fact("vehicle", "Synthetic car", vehicle.data, {
          family_id: vehicle.family_id,
          expected_ordinal: 1,
          state: "withdrawn",
          record_ids: [record],
        }),
      );
    },
  );
  await serialSubtest(t,
    "document payment identities normalize whitespace and stay immutable across revisions",
    async () => {
      const data = {
        payment_reference: "  Synthetic   Document ITEM 7 ",
        paid_total_pence: 10000,
        allocated_pence: 10000,
        allocation_type: "balancing_payment",
        payment_date: "2025-10-01",
      };
      const saved = await save(fact("tax_payment", "Document payment", data));
      await assert.rejects(
        save(
          fact("tax_payment", "Whitespace duplicate", {
            ...data,
            payment_reference: "synthetic document item 7",
            allocated_pence: 1,
          }),
        ),
        /already allocated/,
      );
      await assert.rejects(
        save(
          fact(
            "tax_payment",
            "Document payment",
            { ...data, payment_reference: "Changed payment identity" },
            { family_id: saved.family_id, expected_ordinal: 1 },
          ),
        ),
        /identity is immutable/,
      );
    },
  );
  await serialSubtest(t,
    "late audit failure rolls back every fact/source write; history and owner isolation hold",
    async () => {
      const before = (await facts()).length,
        request = randomUUID();
      await db.exec("reset role");
      await db.exec(
        `create function fail_tax_audit() returns trigger language plpgsql as $$begin if new.request_id='${request}'::uuid then raise exception 'Synthetic tax audit failure';end if;return new;end;$$;create trigger fail_tax_audit before insert on tax_review_requests for each row execute function fail_tax_audit()`,
      );
      await auth();
      await assert.rejects(
        save(
          fact("gift_aid", "Rollback synthetic donation", {
            net_donation_pence: 5000,
            payment_date: "2025-07-06",
          }),
          2025,
          undefined,
          request,
        ),
        /Synthetic tax audit failure/,
      );
      assert.equal((await facts()).length, before);
      for (const sql of [
        "delete from tax_fact_revisions",
        "update tax_profile_revisions set state='reviewed'",
        "delete from tax_fact_sources",
      ])
        await assert.rejects(db.exec(sql), /permission denied/);
      const family = (await facts())[0];
      await auth(other);
      assert.equal((await facts()).length, 0);
      assert.equal(
        (await db.query("select * from tax_fact_source_history")).rows.length,
        0,
      );
      await assert.rejects(
        save(
          fact("employment", "Synthetic employer", employment, {
            family_id: family.family_id,
            expected_ordinal: 4,
          }),
        ),
        /Owned fact identity/,
      );
      await auth(null);
      await assert.rejects(
        db.query("select tax_review_stamp(2025)"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from current_tax_facts"),
        /permission denied/,
      );
      await auth();
    },
  );
});
