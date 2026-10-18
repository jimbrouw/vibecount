import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("reviewed allocations preserve one receipt, partial balances, reversals and accounting invariants", async (t) => {
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
  const account = (
    await db.query<{ id: string }>(
      "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic bank','starling','bank','1234') returning id",
      [owner],
    )
  ).rows[0].id;
  const attempt = randomUUID();
  await db.query(
    "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'fixture/settlements.enc','test',100,'uploaded')",
    [attempt, owner, account, "a".repeat(64)],
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values ('source-evidence','fixture/settlements.enc'); set role service_role",
  );
  const imported = (
    await db.query<{ result: { import_id: string } }>(
      "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3::jsonb) result",
      [
        owner,
        attempt,
        JSON.stringify(
          [150000, 50000, 20000, 10000].map((amount, i) => ({
            row_number: i + 2,
            row_hash: String(i + 1).repeat(64),
            raw_encrypted: "synthetic",
            date: "2026-02-01",
            signed_pence: amount,
            currency: "GBP",
            description:
              i === 0
                ? "Former employer freelance receipt"
                : "Synthetic receipt",
            reference: "INV-" + i,
            fingerprint: String(i + 1).repeat(64),
          })),
        ),
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const txs = (
    await db.query<{ id: string; signed_amount_pence: number }>(
      "select id,signed_amount_pence::float8 from bank_transactions where import_id=$1 order by signed_amount_pence desc",
      [imported.import_id],
    )
  ).rows;
  const category = (
    await db.query<{ id: string }>(
      "select id from record_categories where record_type='income' and is_default limit 1",
    )
  ).rows[0].id;
  const client = (
    await db.query<{ id: string }>(
      "insert into clients(user_id,name) values ($1,'Synthetic client') returning id",
      [owner],
    )
  ).rows[0].id;
  const foreignClient = (
    await db.query<{ id: string }>(
      "insert into clients(user_id,name) values ($1,'Foreign client') returning id",
      [other],
    )
  ).rows[0].id;
  const invoices: string[] = [];
  for (const [i, amount] of [1000, 1000, 500, 250].entries())
    invoices.push(
      (
        await db.query<{ id: string }>(
          "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,$3,'Synthetic invoice',$4,'finalised') returning id",
          [owner, client, "DEMO-" + i, amount],
        )
      ).rows[0].id,
    );
  const foreignInvoice = (
    await db.query<{ id: string }>(
      "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,'OTHER','Other invoice',500,'finalised') returning id",
      [other, foreignClient],
    )
  ).rows[0].id;
  await asUser();
  for (const tx of txs.slice(0, 3))
    await db.query(
      "select review_bank_transaction($1,0,'Business',$2,10000,'Human reviewed synthetic receipt')",
      [tx.id, category],
    );
  async function entry(invoice: string, pence: number) {
    return {
      invoice_id: invoice,
      amount_pence: pence,
      invoice_updated_at: (
        await db.query<{ version: string }>(
          "select updated_at::text version from invoices where id=$1",
          [invoice],
        )
      ).rows[0].version,
    };
  }
  async function allocate(
    tx: string,
    entries: unknown[],
    request = randomUUID(),
    version = 1,
    expected?: number,
  ) {
    const expectedAllocated =
      expected ??
      (
        await db.query<{ pence: number }>(
          "select coalesce(sum(amount_pence),0)::float8 pence from active_invoice_allocations where transaction_id=$1",
          [tx],
        )
      ).rows[0].pence;
    return (
      await db.query<{
        result: {
          allocation_ids: string[];
          allocated_pence: number;
          unallocated_pence: number;
        };
      }>(
        "select approve_invoice_allocations($1,$2,$3::jsonb,'Reviewed match',$4,$5) result",
        [tx, version, JSON.stringify(entries), request, expectedAllocated],
      )
    ).rows[0].result;
  }
  async function balance(invoice: string) {
    return (
      await db.query<{
        allocated_pence: number;
        outstanding_pence: number;
        delivery_status: string;
      }>(
        "select allocated_pence::float8,outstanding_pence::float8,delivery_status from invoice_payment_balances where id=$1",
        [invoice],
      )
    ).rows[0];
  }
  async function income() {
    return (
      await db.query<{ n: number; pence: number }>(
        "select count(*)::int n,sum(amount*100)::float8 pence from financial_records where user_id=$1 and status='approved' and record_type='income'",
        [owner],
      )
    ).rows[0];
  }
  let firstAllocation = "";
  await serialSubtest(t,
    "one receipt pays several invoices, retries are exact and income is never duplicated",
    async () => {
      const before = await income(),
        request = randomUUID();
      const entries = [
        await entry(invoices[0], 100000),
        await entry(invoices[1], 50000),
      ];
      const result = await allocate(txs[0].id, entries, request);
      firstAllocation = result.allocation_ids[0];
      assert.equal(result.unallocated_pence, 0);
      assert.deepEqual(await income(), before);
      assert.deepEqual(
        await allocate(txs[0].id, entries, request, 1, 0),
        result,
      );
      await assert.rejects(
        allocate(txs[0].id, [entries[0]], request),
        /different review/,
      );
      assert.equal((await balance(invoices[0])).outstanding_pence, 0);
      assert.equal((await balance(invoices[0])).delivery_status, "paid");
      assert.equal((await balance(invoices[1])).outstanding_pence, 50000);
      assert.equal(
        (await db.query("select * from invoice_settlements")).rows.length,
        2,
      );
    },
  );
  await serialSubtest(t,
    "several receipts settle one invoice; partial allocations retain unallocated cash",
    async () => {
      await allocate(txs[1].id, [await entry(invoices[1], 50000)]);
      assert.equal((await balance(invoices[1])).outstanding_pence, 0);
      const partial = await allocate(txs[2].id, [
        await entry(invoices[2], 10000),
      ]);
      assert.equal(partial.unallocated_pence, 10000);
      assert.equal((await balance(invoices[2])).outstanding_pence, 40000);
      assert.deepEqual(await income(), { n: 3, pence: 220000 });
    },
  );
  await serialSubtest(t,
    "over-allocation, stale snapshots, unreviewed and foreign inputs roll back",
    async () => {
      const before = (await db.query("select * from invoice_settlements")).rows
        .length;
      await assert.rejects(
        allocate(
          txs[2].id,
          [await entry(invoices[3], 100)],
          randomUUID(),
          1,
          0,
        ),
        /Receipt allocations changed/,
      );
      await assert.rejects(
        allocate(txs[2].id, [await entry(invoices[2], 10001)]),
        /unallocated receipt/,
      );
      await assert.rejects(
        allocate(txs[2].id, [await entry(invoices[0], 1)]),
        /outstanding/,
      );
      const stale = await entry(invoices[3], 100);
      // Simulate a separate privileged revision while retaining the stale browser snapshot.
      await db.exec("reset role");
      await db.query("update invoices set due_date='2026-05-01' where id=$1", [
        invoices[3],
      ]);
      await asUser();
      await assert.rejects(allocate(txs[2].id, [stale]), /Invoice changed/);
      await assert.rejects(
        allocate(txs[2].id, [await entry(invoices[3], 100)], randomUUID(), 0),
        /decision changed/,
      );
      await assert.rejects(
        allocate(txs[3].id, [await entry(invoices[3], 100)], randomUUID(), 0),
        /complete receipt/,
      );
      await assert.rejects(
        allocate(txs[2].id, [
          await entry(invoices[3], 100),
          {
            invoice_id: foreignInvoice,
            amount_pence: 1,
            invoice_updated_at: new Date().toISOString(),
          },
        ]),
        /owned finalised/,
      );
      assert.equal(
        (await db.query("select * from invoice_settlements")).rows.length,
        before,
      );
    },
  );
  await serialSubtest(t,
    "allocated receipts/invoice facts cannot be silently invalidated or mutated",
    async () => {
      await assert.rejects(
        db.query(
          "select review_bank_transaction($1,1,'Personal',null,0,'Exclude')",
          [txs[0].id],
        ),
        /Reverse invoice allocations/,
      );
      await assert.rejects(
        db.query(
          "select review_bank_transaction_v1($1,1,'Personal',null,0,'Bypass')",
          [txs[0].id],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query("update invoices set amount=1 where id=$1", [invoices[0]]),
        /reviewed correction/,
      );
      await assert.rejects(
        db.query(
          "update invoices set paid_at=null,delivery_status='sent' where id=$1",
          [invoices[0]],
        ),
        /evidence-backed/,
      );
      await assert.rejects(
        db.query("update invoices set due_date='2026-05-01' where id=$1", [
          invoices[0],
        ]),
        /reviewed correction/,
      );
      await assert.rejects(
        db.query("delete from invoices where id=$1", [invoices[0]]),
        /Preserve invoices/,
      );
      await assert.rejects(
        db.query("delete from invoice_settlements"),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "insert into settlement_requests(user_id,request_id,payload_hash,result) values ($1,$2,'x','{}')",
          [owner, randomUUID()],
        ),
        /permission denied/,
      );
      await db.exec("reset role; set role service_role");
      await assert.rejects(
        db.query(
          "insert into settlement_requests(user_id,request_id,payload_hash,result) values ($1,$2,'x','{}')",
          [owner, randomUUID()],
        ),
        /permission denied/,
      );
      await db.query("update invoices set next_reminder_at=null where id=$1", [
        invoices[0],
      ]);
      await asUser();
    },
  );
  await serialSubtest(t,
    "allocation reversal restores outstanding while preserving receipt income",
    async () => {
      const before = await income(),
        request = randomUUID();
      const sql =
        "select reverse_invoice_allocation($1,'Wrong invoice reviewed',$2) result";
      const reversed = (await db.query(sql, [firstAllocation, request])).rows;
      assert.deepEqual(
        (await db.query(sql, [firstAllocation, request])).rows,
        reversed,
      );
      assert.equal((await balance(invoices[0])).outstanding_pence, 100000);
      assert.deepEqual(await income(), before);
      await assert.rejects(
        db.query(sql, [firstAllocation, randomUUID()]),
        /not found/,
      );
    },
  );
  await serialSubtest(t,
    "import reversal includes allocation state in read-back, reverses relationships and reopening restores nothing",
    async () => {
      const summary = async () =>
        (
          await db.query<{
            result: {
              stamp: string;
              allocation_count: number;
              allocation_pence: number;
            };
          }>("select source_import_summary($1) result", [imported.import_id])
        ).rows[0].result;
      const old = await summary();
      await allocate(txs[2].id, [await entry(invoices[3], 100)]);
      await assert.rejects(
        db.query("select reverse_source_import($1,$2,'Reviewed reversal')", [
          imported.import_id,
          old.stamp,
        ]),
        /allocations.*changed/,
      );
      const current = await summary();
      assert.equal(current.allocation_count, 4);
      await db.query(
        "select reverse_source_import($1,$2,'Reviewed complete import reversal')",
        [imported.import_id, current.stamp],
      );
      for (const [i, total] of [100000, 100000, 50000, 25000].entries())
        assert.equal((await balance(invoices[i])).outstanding_pence, total);
      assert.equal(
        (await db.query("select * from active_invoice_allocations")).rows
          .length,
        0,
      );
      assert.equal((await income()).n, 0);
      await db.query("select reopen_source_import($1)", [imported.import_id]);
      assert.equal((await income()).n, 0);
      assert.equal(
        (await db.query("select * from active_invoice_allocations")).rows
          .length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "cross-owner and anonymous reads/writes cannot access reconciliation",
    async () => {
      await asUser(other);
      assert.equal(
        (await db.query("select * from invoice_settlements")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from receipt_allocation_balances")).rows
          .length,
        0,
      );
      await assert.rejects(
        allocate(txs[0].id, [], randomUUID()),
        /distinct invoices/,
      );
      await assert.rejects(
        db.query("select reverse_invoice_allocation($1,'foreign',$2)", [
          firstAllocation,
          randomUUID(),
        ]),
        /not found/,
      );
      await db.exec("reset role; set role anon");
      await assert.rejects(
        db.query("select * from invoice_settlements"),
        /permission denied/,
      );
      await assert.rejects(
        allocate(txs[0].id, [], randomUUID()),
        /permission denied/,
      );
    },
  );
});
