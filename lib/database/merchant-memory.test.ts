import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
import type { MerchantChoice } from "../records/merchant-memory.ts";

test("merchant memory preserves scopes, human approval, exact batch effects and reversible provenance", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const n of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(n, dir), "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  async function account(user = owner) {
    await db.exec("reset role");
    return (
      await db.query<{ id: string }>(
        "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic memory','starling','bank','1234') returning id",
        [user],
      )
    ).rows[0].id;
  }
  const bank = await account(),
    bank2 = await account(),
    foreignBank = await account(other);
  const expense = (
    await db.query<{ id: string }>(
      "select id from record_categories where is_default and user_id is null and record_type='expense' limit 1",
    )
  ).rows[0].id;
  const income = (
    await db.query<{ id: string }>(
      "select id from record_categories where is_default and user_id is null and record_type='income' limit 1",
    )
  ).rows[0].id;
  async function auth(user: string | null = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? "",
    ]);
    await db.exec(user ? "set role authenticated" : "set role anon");
  }
  async function ingest(
    description: string,
    amount = -1250,
    date = "2025-07-06",
    acc = bank,
    user = owner,
  ) {
    await db.exec("reset role");
    const id = randomUUID(),
      path = `${user}/${acc}/${id}.enc`,
      hash = randomBytes(32).toString("hex");
    await db.query(
      "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'test',100,'uploaded')",
      [id, user, acc, hash, path],
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
          user,
          id,
          JSON.stringify([
            {
              row_number: 2,
              row_hash: hash,
              raw_encrypted: "synthetic",
              date,
              signed_pence: amount,
              currency: "GBP",
              description,
              reference: "Synthetic",
              fingerprint: randomBytes(32).toString("hex"),
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
  async function stamp() {
    return (
      await db.query<{ s: string }>("select reconciliation_export_stamp() s")
    ).rows[0].s;
  }
  async function choice(id: string) {
    return (
      await db.query<MerchantChoice>(
        "select * from merchant_transaction_choices where id=$1",
        [id],
      )
    ).rows[0];
  }
  async function rule(
    seed: string,
    changes: Record<string, unknown> = {},
    id: string | null = null,
    version = 0,
    s?: string,
    request = randomUUID(),
  ) {
    const tx = await choice(seed);
    const definition = {
      seed_id: seed,
      status: "active",
      account_id: null,
      tax_year_start: 2025,
      effective_from: "2025-04-06",
      expires_on: "2026-04-05",
      priority: 50,
      classification: "Business",
      business_use_bps: 10000,
      category_id: Number(tx.signed_amount_pence) > 0 ? income : expense,
      evidence_status: "provisional",
      ...changes,
    };
    const result = (
      await db.query<{
        r: { rule_id: string; version_id: string; ordinal: number };
      }>(
        "select save_merchant_rule($1,$2,$3,$4,'Reviewed merchant intent',$5) r",
        [
          id,
          version,
          JSON.stringify(definition),
          s ?? (await stamp()),
          request,
        ],
      )
    ).rows[0].r;
    return { result, definition };
  }
  async function entry(
    tx: string,
    origin = "rule",
    extra: Record<string, unknown> = {},
  ) {
    const row = await choice(tx);
    return {
      transaction_id: tx,
      version: row.decision_version,
      origin,
      rule_version_id: row.suggested_rule_version_id,
      evidence_status: "provisional",
      document_ids: [],
      ...extra,
    };
  }
  async function apply(entries: unknown[], s?: string, request = randomUUID()) {
    return (
      await db.query<{
        r: { batch_id: string; reviewed: number; expense_after_pence: number };
      }>(
        "select approve_merchant_batch($1,$2,'Reviewed every selected source',$3) r",
        [JSON.stringify(entries), s ?? (await stamp()), request],
      )
    ).rows[0].r;
  }
  async function undo(id: string, s?: string, request = randomUUID()) {
    return (
      await db.query<{ r: { removed_expense_pence: number } }>(
        "select reverse_merchant_batch($1,$2,'Undo and leave unresolved',$3) r",
        [id, s ?? (await stamp()), request],
      )
    ).rows[0].r;
  }
  await serialSubtest(t,
    "rule saves have zero effects; normalization, account/year/dates and precedence are deterministic",
    async () => {
      const a = await ingest("  SquareSpace   PLAN "),
        b = await ingest("squarespace plan", -1250, "2025-08-06"),
        c = await ingest("squarespace plan", -1250, "2026-04-06"),
        otherAccount = await ingest(
          "squarespace plan",
          -1250,
          "2025-08-06",
          bank2,
        );
      const first = await rule(a, { account_id: bank });
      assert.equal(
        (await choice(b)).suggested_rule_version_id,
        first.result.version_id,
      );
      assert.equal((await choice(c)).suggested_rule_version_id, null);
      assert.equal(
        (await choice(otherAccount)).suggested_rule_version_id,
        null,
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
      const conflict = await rule(a, { account_id: bank });
      assert.equal((await choice(b)).top_rule_count, 2);
      await assert.rejects(apply([await entry(b)]), /competing rules/);
      await rule(
        a,
        { account_id: bank, status: "disabled" },
        conflict.result.rule_id,
        1,
      );
      assert.equal((await choice(b)).top_rule_count, 1);
      const global = await rule(a, {
        priority: 60,
        tax_year_start: null,
        expires_on: null,
      });
      assert.equal(
        (await choice(b)).suggested_rule_version_id,
        global.result.version_id,
      );
      assert.equal(
        (await choice(c)).suggested_rule_version_id,
        global.result.version_id,
      );
      const incoming = await ingest("squarespace plan", 1250);
      assert.equal((await choice(incoming)).top_rule_count, 0);
    },
  );
  await serialSubtest(t,
    "only explicitly selected IDs apply once and mixed-use pennies, category snapshot and undo agree",
    async () => {
      const a = await ingest("Synthetic car repair", -63029),
        b = await ingest("Synthetic car repair", -63029, "2025-08-06");
      await rule(a, { classification: "Mixed", business_use_bps: 3000 });
      const s = await stamp(),
        request = randomUUID(),
        entries = [await entry(a)],
        applied = await apply(entries, s, request);
      assert.equal(applied.expense_after_pence, 18909);
      assert.deepEqual(await apply(entries, s, request), applied);
      assert.equal((await choice(b)).classification, "Unknown");
      assert.equal((await choice(a)).classification, "Mixed");
      await assert.rejects(
        apply([await entry(b)], s, request),
        /another review/,
      );
      const before = (
        await db.query<{ recognized_pence: string }>(
          "select recognized_pence from merchant_review_items where batch_id=$1",
          [applied.batch_id],
        )
      ).rows[0];
      assert.equal(Number(before.recognized_pence), 18909);
      const reversed = await undo(applied.batch_id);
      assert.equal(reversed.removed_expense_pence, 18909);
      assert.equal((await choice(a)).classification, "Unknown");
      assert.equal(Number((await choice(a)).recognized_pence), 0);
      assert.equal(
        (
          await db.query(
            "select * from merchant_review_items where batch_id=$1",
            [applied.batch_id],
          )
        ).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from merchant_review_undo_items")).rows
          .length,
        1,
      );
    },
  );
  await serialSubtest(t,
    "Personal decisions survive memory and explicit overrides retain provenance; stale mixed batches roll back completely",
    async () => {
      const a = await ingest("Personal lodging", -46309),
        b = await ingest("Personal lodging", -18900, "2025-08-06");
      await db.query(
        "select review_bank_transaction($1,0,'Personal',null,0,'Reviewed personal trip')",
        [a],
      );
      await rule(a);
      await assert.rejects(apply([await entry(a)]), /explicit override/);
      assert.equal((await choice(a)).classification, "Personal");
      const override = await apply([
        await entry(a, "override", {
          classification: "Personal",
          business_use_bps: 0,
          category_id: null,
        }),
      ]);
      assert.ok(override.batch_id);
      assert.equal((await choice(a)).classification, "Personal");
      const first = await entry(b),
        stale = {
          ...first,
          transaction_id: a,
          version: 0,
          origin: "override",
          classification: "Personal",
          business_use_bps: 0,
          category_id: null,
        };
      await assert.rejects(apply([first, stale]), /Source scope changed/);
      assert.equal((await choice(b)).classification, "Unknown");
      const s = await stamp();
      await rule(b, { priority: 80 });
      await assert.rejects(apply([first], s), /state changed/);
      await db.query(
        "select review_bank_transaction($1,$2,'Personal',null,0,'Intervening choice')",
        [a, (await choice(a)).decision_version],
      );
      await assert.rejects(undo(override.batch_id), /decision changed/);
    },
  );
  await serialSubtest(t,
    "evidence links require owned documents and linked status cannot be invented",
    async () => {
      const a = await ingest("Synthetic software with receipt");
      await rule(a);
      await assert.rejects(
        apply([await entry(a, "rule", { evidence_status: "linked" })]),
        /evidence status/,
      );
      await db.exec("reset role");
      const doc = (
        await db.query<{ id: string }>(
          "insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,$3,'test') returning id",
          [owner, "a".repeat(64), owner + "/" + randomUUID()],
        )
      ).rows[0].id;
      const foreign = (
        await db.query<{ id: string }>(
          "insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',100,$3,'test') returning id",
          [other, "b".repeat(64), other + "/" + randomUUID()],
        )
      ).rows[0].id;
      await auth();
      await assert.rejects(
        apply([
          await entry(a, "rule", {
            evidence_status: "linked",
            document_ids: [foreign],
          }),
        ]),
        /Owned evidence/,
      );
      const approved = await apply([
        await entry(a, "rule", {
          evidence_status: "linked",
          document_ids: [doc],
        }),
      ]);
      const evidence = (
        await db.query<{ document_snapshot: { file_sha256: string } }>(
          "select document_snapshot from merchant_review_evidence where item_id in(select id from merchant_review_items where batch_id=$1)",
          [approved.batch_id],
        )
      ).rows[0];
      assert.equal(evidence.document_snapshot.file_sha256, "a".repeat(64));
      const provenance = (
        await db.query<{
          evidence_status: string;
          review_evidence_status: string;
          merchant_batch_id: string;
          linked_documents: unknown[];
        }>(
          "select * from merchant_decision_provenance where transaction_id=$1",
          [a],
        )
      ).rows[0];
      assert.equal(provenance.evidence_status, "provisional");
      assert.equal(provenance.review_evidence_status, "linked");
      assert.equal(provenance.merchant_batch_id, approved.batch_id);
      assert.equal(provenance.linked_documents.length, 1);
    },
  );
  await serialSubtest(t,
    "batch dependency guards roll back earlier rows and prevent undo after receipt allocation",
    async () => {
      const receipt = await ingest("Merchant allocation receipt", 150000);
      await rule(receipt);
      const applied = await apply([await entry(receipt)]);
      await db.exec("reset role");
      const client = (
        await db.query<{ id: string }>(
          "insert into clients(user_id,name) values ($1,'Synthetic client') returning id",
          [owner],
        )
      ).rows[0].id;
      const invoice = (
        await db.query<{ id: string; updated_at: string }>(
          "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,'MEMORY-1500','Synthetic invoice',1500,'finalised') returning id,updated_at",
          [owner, client],
        )
      ).rows[0];
      await auth();
      await db.query(
        "select approve_invoice_allocations($1,$2,$3,'Reviewed receipt match',$4,0)",
        [
          receipt,
          (await choice(receipt)).decision_version,
          JSON.stringify([
            {
              invoice_id: invoice.id,
              amount_pence: 150000,
              invoice_updated_at: invoice.updated_at,
            },
          ]),
          randomUUID(),
        ],
      );
      await assert.rejects(undo(applied.batch_id), /allocations/i);
      assert.equal((await choice(receipt)).classification, "Business");
      const clean = await ingest("Unrelated manual review");
      const personal = {
        classification: "Personal",
        business_use_bps: 0,
        category_id: null,
        rule_version_id: null,
      };
      await assert.rejects(
        apply([
          await entry(clean, "manual", personal),
          await entry(receipt, "override", personal),
        ]),
        /allocations/i,
      );
      assert.equal((await choice(clean)).classification, "Unknown");
      const out = await ingest("Owned transfer out", -1250),
        incoming = await ingest("Owned transfer in", 1250, "2025-08-06", bank2);
      await db.query(
        "select approve_transfer_pair($1,0,$2,0,'transfer','Reviewed both bank sources',$3)",
        [out, incoming, randomUUID()],
      );
      await assert.rejects(
        apply([
          await entry(clean, "manual", personal),
          await entry(out, "override", personal),
        ]),
        /transfer/i,
      );
      assert.equal((await choice(clean)).classification, "Unknown");
    },
  );
  await serialSubtest(t,
    "invalid ownership, categories, direct writes and anonymous approval are denied",
    async () => {
      const a = await ingest("Category ownership test");
      await db.exec("reset role");
      const own = (
        await db.query<{ id: string }>(
          "insert into record_categories(user_id,name,record_type) values ($1,'Owned expense','expense') returning id",
          [owner],
        )
      ).rows[0].id;
      const foreign = (
        await db.query<{ id: string }>(
          "insert into record_categories(user_id,name,record_type,is_default) values ($1,'Foreign expense','expense',false) returning id",
          [other],
        )
      ).rows[0].id;
      await auth();
      await rule(a, { category_id: own });
      await assert.rejects(
        rule(a, { category_id: foreign }),
        /owned or shared/,
      );
      await assert.rejects(
        rule(a, { account_id: foreignBank }),
        /owned account/,
      );
      await db.exec("reset role");
      await db.query(
        "update record_categories set name='Changed category meaning' where id=$1",
        [own],
      );
      await auth();
      await assert.rejects(apply([await entry(a)]), /category changed/);
      for (const sql of [
        "update merchant_rule_versions set priority=100",
        "delete from merchant_review_items",
        "insert into merchant_rules(user_id,match_key,record_type) values ('" +
          owner +
          "','bad','expense')",
      ])
        await assert.rejects(db.query(sql), /permission denied/);
      const foreignTx = await ingest(
        "Foreign source",
        -100,
        "2025-08-06",
        foreignBank,
        other,
      );
      await assert.rejects(
        apply([
          {
            transaction_id: foreignTx,
            version: 0,
            origin: "manual",
            classification: "Personal",
            business_use_bps: 0,
            category_id: null,
            document_ids: [],
            evidence_status: "missing",
          },
        ]),
        /actual GBP/,
      );
      await auth(other);
      assert.equal(
        (await db.query("select * from current_merchant_rules")).rows.length,
        0,
      );
      await auth(null);
      await assert.rejects(
        db.query("select * from merchant_review_items"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select approve_merchant_batch('[]','s','reason',$1)", [
          randomUUID(),
        ]),
        /permission denied/,
      );
      await auth();
    },
  );
});
