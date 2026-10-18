import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("reviewed refunds preserve original evidence, exact signed effects and cumulative rounding", async (t) => {
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
  const account = (
    await db.query<{ id: string }>(
      "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic refund bank','generic','bank','1234') returning id",
      [owner],
    )
  ).rows[0].id;
  async function asUser(id = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function source(amounts: number[], date: string) {
    await db.exec("reset role");
    const attempt = randomUUID(),
      path = `${owner}/${attempt}.enc`;
    await db.query(
      "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'test',100,'uploaded')",
      [attempt, owner, account, randomBytes(32).toString("hex"), path],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('source-evidence',$1)",
      [path],
    );
    const result = (
      await db.query<{ result: { import_id: string } }>(
        "select ingest_source_csv($1,$2,'synthetic-refunds.csv','mapped-csv/1','{}',$3::jsonb) result",
        [
          owner,
          attempt,
          JSON.stringify(
            amounts.map((a, i) => ({
              row_number: i + 2,
              row_hash: randomBytes(32).toString("hex"),
              raw_encrypted: "synthetic",
              date,
              signed_pence: a,
              currency: "GBP",
              description: "Synthetic cash observation",
              reference: "",
              fingerprint: randomBytes(32).toString("hex"),
            })),
          ),
        ],
      )
    ).rows[0].result;
    const rows = (
      await db.query<{ id: string }>(
        "select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number",
        [result.import_id],
      )
    ).rows;
    await asUser();
    return { import: result.import_id, tx: rows.map((r) => r.id) };
  }
  const original = await source([-63029, 150000, -2], "2026-04-05");
  const first = await source([10000], "2026-04-06");
  const second = await source([53029], "2026-04-07");
  const customer = await source([-50000], "2026-04-06");
  const pennies = await source([1, 1], "2026-04-06");
  const extra = await source([1], "2026-04-08");
  const expense = (
    await db.query<{ id: string }>(
      "select id from record_categories where is_default and record_type='expense' and name='Travel costs' limit 1",
    )
  ).rows[0].id;
  const income = (
    await db.query<{ id: string }>(
      "select id from record_categories where is_default and record_type='income' limit 1",
    )
  ).rows[0].id;
  await db.query(
    "select review_bank_transaction($1,0,'Mixed',$2,3000,'Reviewed car repair candidate')",
    [original.tx[0], expense],
  );
  await db.query(
    "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed freelance receipt')",
    [original.tx[1], income],
  );
  await db.query(
    "select review_bank_transaction($1,0,'Mixed',$2,5000,'Synthetic rounding fixture')",
    [original.tx[2], expense],
  );
  await db.query(
    "select review_bank_transaction($1,0,'Business',$2,10000,'Prior incorrect interpretation')",
    [first.tx[0], income],
  );
  const stamp = async (id: string) =>
    (await db.query<{ s: string }>("select refund_group_stamp($1) s", [id]))
      .rows[0].s;
  async function approve(
    o: string,
    r: string,
    ov = 1,
    rv = 0,
    request = randomUUID(),
    expected?: string,
  ) {
    return (
      await db.query<{
        result: {
          refund_id: string;
          recognized_pence: number;
          cash_pence: number;
        };
      }>(
        "select approve_refund($1,$2,$3,$4,$5,'Checked original and refund evidence',$6) result",
        [o, ov, r, rv, expected ?? (await stamp(o)), request],
      )
    ).rows[0].result;
  }
  const initialStamp = await stamp(original.tx[0]),
    request = randomUUID();
  await assert.rejects(
    approve(original.tx[0], first.tx[0], 0, 1),
    /decisions changed/,
  );
  const a = await approve(
    original.tx[0],
    first.tx[0],
    1,
    1,
    request,
    initialStamp,
  );
  assert.equal(a.recognized_pence, -3000);
  assert.equal(a.cash_pence, 10000);
  assert.deepEqual(
    await approve(original.tx[0], first.tx[0], 1, 1, request, initialStamp),
    a,
  );
  await assert.rejects(
    approve(original.tx[0], second.tx[0], 1, 0, request),
    /request changed/,
  );
  const afterFirst = await stamp(original.tx[0]);
  const b = await approve(original.tx[0], second.tx[0]);
  assert.equal(b.recognized_pence, -15909);
  await assert.rejects(
    approve(original.tx[0], extra.tx[0]),
    /exceeds remaining/,
  );
  const refundPosting = (
    await db.query<{
      amount: string;
      effect_sign: number;
      record_type: string;
      tax_year_start: number;
    }>(
      "select amount,effect_sign,record_type,tax_year_start from financial_records where bank_transaction_id=$1 and status='approved'",
      [first.tx[0]],
    )
  ).rows[0];
  assert.deepEqual(refundPosting, {
    amount: "30.00",
    effect_sign: -1,
    record_type: "expense",
    tax_year_start: 2026,
  });
  assert.equal(
    (
      await db.query(
        "select id from financial_records where bank_transaction_id=$1 and status='approved'",
        [first.tx[0]],
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    db.query(
      "select review_bank_transaction($1,1,'Personal',null,0,'Bypass original')",
      [original.tx[0]],
    ),
    /refund group/,
  );
  await assert.rejects(
    db.query(
      "select approve_transfer_pair($1,1,$2,2,'transfer','Bypass refund',$3)",
      [original.tx[0], first.tx[0], randomUUID()],
    ),
    /refund relationships/,
  );
  await assert.rejects(
    db.query(
      "select review_bank_transaction_v1($1,2,'Business',$2,10000,'Bypass internal')",
      [first.tx[0], income],
    ),
    /permission denied/,
  );
  // Customer refund accounting is separate from the preserved invoice settlement history.
  await db.exec("reset role");
  const client = (
    await db.query<{ id: string }>(
      "insert into clients(user_id,name) values($1,'Synthetic refund client') returning id",
      [owner],
    )
  ).rows[0].id;
  const invoice = (
    await db.query<{ id: string; version: string }>(
      "insert into invoices(user_id,client_id,number,description,amount,status) values($1,$2,'REFUND-DEMO','Synthetic settled invoice',1500,'finalised') returning id,updated_at::text version",
      [owner, client],
    )
  ).rows[0];
  await asUser();
  await db.query(
    "select approve_invoice_allocations($1,1,$2::jsonb,'Original receipt allocation',$3,0)",
    [
      original.tx[1],
      JSON.stringify([
        {
          invoice_id: invoice.id,
          invoice_updated_at: invoice.version,
          amount_pence: 150000,
        },
      ]),
      randomUUID(),
    ],
  );
  const c = await approve(original.tx[1], customer.tx[0]);
  assert.equal(c.recognized_pence, -50000);
  const balance = (
    await db.query<{ outstanding_pence: string; delivery_status: string }>(
      "select outstanding_pence,delivery_status from invoice_payment_balances where id=$1",
      [invoice.id],
    )
  ).rows[0];
  assert.equal(Number(balance.outstanding_pence), 0);
  assert.equal(balance.delivery_status, "paid");
  assert.equal(
    Number(
      (
        await db.query<{ refunded_pence: string }>(
          "select refunded_pence from receipt_allocation_balances where id=$1",
          [original.tx[1]],
        )
      ).rows[0].refunded_pence,
    ),
    50000,
  );
  await assert.rejects(
    db.query(
      "select approve_invoice_allocations($1,1,'[]','Invalid refund receipt',$2,0)",
      [first.tx[0], randomUUID()],
    ),
    /refund observation/,
  );

  const p1 = await approve(original.tx[2], pennies.tx[0]);
  const p2 = await approve(original.tx[2], pennies.tx[1]);
  assert.equal(p1.recognized_pence, -1);
  assert.equal(p2.recognized_pence, 0);
  assert.equal(
    (
      await db.query(
        "select id from financial_records where bank_transaction_id=$1 and status='approved'",
        [pennies.tx[1]],
      )
    ).rows.length,
    0,
  );
  const sums = (
    await db.query<{
      tax_year_start: number;
      income_total: string;
      expense_total: string;
    }>(
      "select tax_year_start,sum(income_total)::text income_total,sum(expense_total)::text expense_total from financial_record_quarter_summaries group by tax_year_start order by tax_year_start",
    )
  ).rows;
  assert.equal(Number(sums[0].income_total), 1500);
  assert.equal(Number(sums[0].expense_total), 189.1);
  assert.equal(Number(sums[1].income_total), -500);
  assert.equal(Number(sums[1].expense_total), -189.1);
  const summary = (
    await db.query<{
      s: {
        income_pence: number;
        expense_pence: number;
        refund_count: number;
        stamp: string;
      };
    }>("select source_import_summary($1) s", [first.import])
  ).rows[0].s;
  assert.equal(summary.income_pence, 0);
  assert.equal(summary.expense_pence, -3000);
  assert.equal(summary.refund_count, 2);
  await assert.rejects(
    db.query("select reverse_refund_group($1,$2,'Stale review',$3)", [
      original.tx[0],
      afterFirst,
      randomUUID(),
    ]),
    /group changed/,
  );
  // Reversing one import dissolves the entire cumulative-rounding family, including other imports.
  await db.query(
    "select reverse_source_import($1,$2,'Reviewed cross-import refund reversal')",
    [first.import, summary.stamp],
  );
  const states = (
    await db.query<{ id: string; classification: string; status: string }>(
      "select t.id,t.classification,f.status from bank_transactions t left join financial_records f on f.bank_transaction_id=t.id and f.effect_sign=-1 where t.id in ($1,$2,$3)",
      [original.tx[0], first.tx[0], second.tx[0]],
    )
  ).rows;
  assert.equal(
    states.find((r) => r.id === original.tx[0])?.classification,
    "Mixed",
  );
  for (const id of [first.tx[0], second.tx[0]]) {
    assert.equal(states.find((r) => r.id === id)?.classification, "Unknown");
    assert.equal(states.find((r) => r.id === id)?.status, "excluded");
  }
  await db.query("select reopen_source_import($1)", [first.import]);
  assert.equal(
    (
      await db.query(
        "select * from active_refunds where original_transaction_id=$1",
        [original.tx[0]],
      )
    ).rows.length,
    0,
  );
  // Explicit reclassification reuses the retained ordinary effect while preserving excluded refund history.
  const version = (
    await db.query<{ decision_version: number }>(
      "select decision_version from bank_transactions where id=$1",
      [first.tx[0]],
    )
  ).rows[0].decision_version;
  await db.query(
    "select review_bank_transaction($1,$2,'Business',$3,10000,'New explicit interpretation')",
    [first.tx[0], version, income],
  );
  const reset = (
    await db.query<{
      effect_sign: number;
      refund_link_id: null;
      record_type: string;
    }>(
      "select effect_sign,refund_link_id,record_type from financial_records where bank_transaction_id=$1 and status='approved'",
      [first.tx[0]],
    )
  ).rows[0];
  assert.deepEqual(reset, {
    effect_sign: 1,
    refund_link_id: null,
    record_type: "income",
  });
  await assert.rejects(
    db.query(
      "insert into financial_records(user_id,record_type,record_date,description,amount,effect_sign) values($1,'expense','2026-04-06','Forged reduction',1,-1)",
      [owner],
    ),
    /reviewed refund/,
  );
  await assert.rejects(
    db.query("delete from refund_links"),
    /permission denied/,
  );
  await asUser(other);
  assert.equal((await db.query("select * from refund_links")).rows.length, 0);
  await assert.rejects(approve(original.tx[0], extra.tx[0]), /not found/);
  await db.exec("reset role;set role anon");
  await assert.rejects(
    approve(original.tx[0], extra.tx[0]),
    /permission denied/,
  );
  await db.exec("reset role");
  await assert.rejects(
    db.query("update refund_links set recognized_pence=0 where id=$1", [
      a.refund_id,
    ]),
    /immutable/,
  );
});
