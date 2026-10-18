import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("reviewed transfers and card repayments exclude both sides and preserve reversal evidence", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  async function asUser(id = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function source(
    user: string,
    label: string,
    kind: string,
    amounts: number[],
    hash: string,
  ) {
    await db.exec("reset role");
    const account = (
      await db.query<{ id: string }>(
        "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,$2,$3,$4,'1234') returning id",
        [user, label, kind === "credit_card" ? "amex" : "generic", kind],
      )
    ).rows[0].id;
    const attempt = randomUUID(),
      path = `fixture/${attempt}.enc`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
      [path],
    );
    await db.query(
      "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'test',100,'uploaded')",
      [attempt, user, account, hash.repeat(64), path],
    );
    await db.exec("set role service_role");
    const imported = (
      await db.query<{ result: { import_id: string } }>(
        "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3::jsonb) result",
        [
          user,
          attempt,
          JSON.stringify(
            amounts.map((amount, i) => ({
              row_number: i + 2,
              row_hash: String(i + 1).padStart(64, "0"),
              raw_encrypted: "synthetic",
              date: label === "Nationwide" ? "2026-04-05" : "2026-04-06",
              signed_pence: amount,
              currency: "GBP",
              description: `Synthetic ${label} ${i}`,
              reference: "",
              fingerprint: String(i + 1).padStart(64, "0"),
            })),
          ),
        ],
      )
    ).rows[0].result;
    const rows = (
      await db.query<{ id: string }>(
        "select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number",
        [imported.import_id],
      )
    ).rows.map((r) => r.id);
    return { account, importId: imported.import_id, tx: rows };
  }
  const nationwide = await source(
    owner,
    "Nationwide",
    "bank",
    [-150000, -30000, 150000, -25000, -50000],
    "a",
  );
  const starling = await source(
    owner,
    "Starling",
    "bank",
    [150000, 150000, 25000, 151001, 50000, 10000],
    "b",
  );
  const amex = await source(owner, "Amex", "credit_card", [30000, -63029], "c");
  const foreign = await source(other, "Other", "bank", [150000], "d");
  const reversed = await source(owner, "Reversed", "bank", [-10000], "e");
  await db.exec("reset role");
  await db.query(
    "update bank_transactions set dedupe_status='needs_review' where id=$1",
    [nationwide.tx[4]],
  );
  const categories = (
    await db.query<{ id: string; record_type: string }>(
      "select id,record_type from record_categories where is_default",
    )
  ).rows;
  const income = categories.find((c) => c.record_type === "income")!.id,
    expense = categories.find((c) => c.record_type === "expense")!.id;
  const client = (
    await db.query<{ id: string }>(
      "insert into clients(user_id,name) values ($1,'Synthetic transfer review') returning id",
      [owner],
    )
  ).rows[0].id;
  const invoice = (
    await db.query<{ id: string; version: string }>(
      "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,'TRANSFER-BLOCK','Synthetic receipt invoice',250,'finalised') returning id,updated_at::text version",
      [owner, client],
    )
  ).rows[0];
  await asUser();
  for (const id of [nationwide.tx[0], nationwide.tx[1]])
    await db.query(
      "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed expense')",
      [id, expense],
    );
  for (const id of [starling.tx[0], starling.tx[2], amex.tx[0]])
    await db.query(
      "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed receipt')",
      [id, income],
    );
  await db.query(
    "select review_bank_transaction($1,0,'Mixed',$2,3000,'Reviewed card purchase')",
    [amex.tx[1], expense],
  );
  await db.query(
    "select approve_invoice_allocations($1,1,$2::jsonb,'Reviewed receipt match',$3,0)",
    [
      starling.tx[2],
      JSON.stringify([
        {
          invoice_id: invoice.id,
          amount_pence: 10000,
          invoice_updated_at: invoice.version,
        },
      ]),
      randomUUID(),
    ],
  );
  const version = async (id: string) =>
    (
      await db.query<{ decision_version: number }>(
        "select decision_version from bank_transactions where id=$1",
        [id],
      )
    ).rows[0].decision_version;
  async function pair(
    out: string,
    inc: string,
    kind = "transfer",
    request = randomUUID(),
    ov?: number,
    iv?: number,
  ) {
    return (
      await db.query<{ result: { pair_id: string; amount_pence: number } }>(
        "select approve_transfer_pair($1,$2,$3,$4,$5,'Human reviewed both sources',$6) result",
        [
          out,
          ov ?? (await version(out)),
          inc,
          iv ?? (await version(inc)),
          kind,
          request,
        ],
      )
    ).rows[0].result;
  }
  const totals = async () =>
    (
      await db.query<{ income: number; expense: number }>(
        "select coalesce(sum(amount*100) filter(where record_type='income'),0)::float8 income,coalesce(sum(amount*100) filter(where record_type='expense'),0)::float8 expense from financial_records where user_id=$1 and status='approved'",
        [owner],
      )
    ).rows[0];
  const summary = async (importId: string) =>
    (
      await db.query<{
        result: {
          stamp: string;
          transfer_count: number;
          transfer_pence: number;
        };
      }>("select source_import_summary($1) result", [importId])
    ).rows[0].result;
  let transfer = "",
    card = "";
  await serialSubtest(t,
    "invalid signs, amount/account types, duplicates and allocated receipts cannot be paired",
    async () => {
      await assert.rejects(
        pair(nationwide.tx[0], nationwide.tx[2]),
        /different owned accounts/,
      );
      await assert.rejects(pair(starling.tx[0], nationwide.tx[0]), /opposite/);
      await assert.rejects(pair(nationwide.tx[0], starling.tx[3]), /opposite/);
      await assert.rejects(
        pair(nationwide.tx[0], starling.tx[0], "card_repayment"),
        /bank-to-bank/,
      );
      await assert.rejects(
        pair(nationwide.tx[1], amex.tx[0], "transfer"),
        /bank-to-bank/,
      );
      await assert.rejects(pair(nationwide.tx[4], starling.tx[4]), /duplicate/);
      await assert.rejects(
        pair(nationwide.tx[3], starling.tx[2]),
        /invoice allocations/,
      );
      await assert.rejects(
        pair(nationwide.tx[0], starling.tx[0], "transfer", randomUUID(), 0, 0),
        /decisions changed/,
      );
      await assert.rejects(
        pair(nationwide.tx[0], foreign.tx[0], "transfer", randomUUID(), 1, 0),
        /Incoming transaction not found/,
      );
      const stamp = (await summary(reversed.importId)).stamp;
      await db.query("select reverse_source_import($1,$2,'Reversed source')", [
        reversed.importId,
        stamp,
      ]);
      await assert.rejects(pair(reversed.tx[0], starling.tx[5]), /Reopen/);
      assert.deepEqual(await totals(), { income: 205000, expense: 198909 });
    },
  );
  await serialSubtest(t,
    "Nationwide-to-Starling transfer has no turnover/deduction, supports exact retry and blocks independent reclassification",
    async () => {
      const old = (await summary(nationwide.importId)).stamp,
        request = randomUUID();
      const result = await pair(
        nationwide.tx[0],
        starling.tx[0],
        "transfer",
        request,
        1,
        1,
      );
      transfer = result.pair_id;
      assert.deepEqual(
        await pair(nationwide.tx[0], starling.tx[0], "transfer", request, 1, 1),
        result,
      );
      await assert.rejects(
        pair(nationwide.tx[0], starling.tx[1], "transfer", request, 1, 0),
        /different transfer review/,
      );
      await assert.rejects(
        pair(nationwide.tx[0], starling.tx[1]),
        /already has/,
      );
      assert.deepEqual(await totals(), { income: 55000, expense: 48909 });
      const current = await summary(nationwide.importId);
      assert.equal(current.transfer_count, 1);
      assert.equal(current.transfer_pence, 150000);
      assert.notEqual(current.stamp, old);
      await assert.rejects(
        db.query(
          "select review_bank_transaction($1,$2,'Business',$3,10000,'Try reclassify')",
          [starling.tx[0], await version(starling.tx[0]), income],
        ),
        /Reverse the transfer pair/,
      );
      await assert.rejects(
        db.query(
          "select review_bank_transaction_v2($1,1,'Business',$2,10000,'Bypass')",
          [starling.tx[0], income],
        ),
        /permission denied/,
      );
    },
  );
  await serialSubtest(t,
    "bank-to-Amex repayment does not deduct card repayment or disturb a reviewed card purchase",
    async () => {
      card = (await pair(nationwide.tx[1], amex.tx[0], "card_repayment"))
        .pair_id;
      assert.deepEqual(await totals(), { income: 25000, expense: 18909 });
      assert.equal(
        (
          await db.query<{ amount: number }>(
            "select (amount*100)::float8 amount from financial_records where bank_transaction_id=$1 and status='approved'",
            [amex.tx[1]],
          )
        ).rows[0].amount,
        18909,
      );
      assert.equal(
        (
          await db.query<{ active_transfer_id: string }>(
            "select active_transfer_id from receipt_allocation_balances where id=$1",
            [amex.tx[0]],
          )
        ).rows[0].active_transfer_id,
        card,
      );
    },
  );
  await serialSubtest(t,
    "pair reversal retains history and leaves both sides unresolved without restoring earlier amounts",
    async () => {
      const request = randomUUID();
      const result = (
        await db.query(
          "select reverse_transfer_pair($1,'Wrong pair reviewed',$2) result",
          [transfer, request],
        )
      ).rows;
      assert.deepEqual(
        (
          await db.query(
            "select reverse_transfer_pair($1,'Wrong pair reviewed',$2) result",
            [transfer, request],
          )
        ).rows,
        result,
      );
      const sides = (
        await db.query<{
          classification: string;
          active_transfer_id: string | null;
        }>(
          "select classification,active_transfer_id from bank_transactions where id in ($1,$2)",
          [nationwide.tx[0], starling.tx[0]],
        )
      ).rows;
      assert.ok(
        sides.every(
          (row) =>
            row.classification === "Unknown" && row.active_transfer_id === null,
        ),
      );
      assert.deepEqual(await totals(), { income: 25000, expense: 18909 });
      transfer = (await pair(nationwide.tx[0], starling.tx[0])).pair_id;
      assert.equal(
        (await db.query("select * from transfer_reversals")).rows.length,
        1,
      );
    },
  );
  await serialSubtest(t,
    "reversing one source dissolves cross-import pairs and never restores counterpart postings",
    async () => {
      const old = await summary(nationwide.importId);
      await db.query(
        "select reverse_transfer_pair($1,'Explicit pair correction',$2)",
        [transfer, randomUUID()],
      );
      await assert.rejects(
        db.query("select reverse_source_import($1,$2,'stale reversal')", [
          nationwide.importId,
          old.stamp,
        ]),
        /transfers.*changed/,
      );
      transfer = (await pair(nationwide.tx[0], starling.tx[0])).pair_id;
      const stamp = (await summary(nationwide.importId)).stamp;
      await db.query(
        "select reverse_source_import($1,$2,'Reviewed cross-account effects')",
        [nationwide.importId, stamp],
      );
      assert.equal(
        (await db.query("select * from active_transfer_pairs")).rows.length,
        0,
      );
      for (const id of [starling.tx[0], amex.tx[0]])
        assert.equal(
          (
            await db.query<{ classification: string }>(
              "select classification from bank_transactions where id=$1",
              [id],
            )
          ).rows[0].classification,
          "Unknown",
        );
      assert.deepEqual(await totals(), { income: 25000, expense: 18909 });
      await db.query("select reopen_source_import($1)", [nationwide.importId]);
      assert.equal(
        (await db.query("select * from active_transfer_pairs")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "pair history is immutable, direct writes/anonymous calls fail and other users cannot read it",
    async () => {
      await assert.rejects(
        db.query("delete from transfer_pairs"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("update bank_transactions set active_transfer_id=null"),
        /permission denied/,
      );
      await db.exec("reset role");
      await assert.rejects(
        db.query("update transfer_pairs set rationale='changed'"),
        /immutable/,
      );
      await asUser(other);
      assert.equal(
        (await db.query("select * from transfer_pairs")).rows.length,
        0,
      );
      await assert.rejects(
        db.query("select reverse_transfer_pair($1,'foreign',$2)", [
          card,
          randomUUID(),
        ]),
        /not found/,
      );
      await db.exec("reset role; set role anon");
      await assert.rejects(
        db.query("select * from transfer_pairs"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select reverse_transfer_pair($1,'anonymous',$2)", [
          card,
          randomUUID(),
        ]),
        /permission denied/,
      );
    },
  );
});
