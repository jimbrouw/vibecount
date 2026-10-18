import {serialSubtest} from './serial-subtest.ts';
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import {
  sourceHash,
  encryptSource,
  sourceContext,
} from "../records/source-crypto.ts";
import {
  normalizeSourceCsv,
  readSourceCsv,
  suggestMapping,
} from "../records/source-csv.ts";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Real embedded PostgreSQL, with a deliberately minimal Supabase schema shim.
// This verifies SQL/RLS/rollback semantics, not Storage HTTP or multi-connection concurrency.
test("migration replay and import confirmation integrity", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  t.beforeEach(() => db.exec("reset role"));
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrationDir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    try {
      if (name === "20261017100000_atomic_import_confirmation.sql") {
        // Rehearse an upgrade with an existing approved record and explicit staging link.
        await db.exec(`
          insert into auth.users values ('33333333-3333-4333-8333-333333333333');
          insert into record_imports(id,user_id,source_type) values
            ('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333333','csv');
          insert into financial_records(id,user_id,record_type,record_date,description,amount,source_type,import_id)
            values ('33333333-3333-4333-8333-333333333335','33333333-3333-4333-8333-333333333333',
              'income','2026-01-01','Legacy receipt',250,'csv','33333333-3333-4333-8333-333333333334');
          insert into csv_import_rows(id,user_id,import_id,row_number,record_type,status,committed_record_id)
            values ('33333333-3333-4333-8333-333333333336','33333333-3333-4333-8333-333333333333',
              '33333333-3333-4333-8333-333333333334',2,'income','committed','33333333-3333-4333-8333-333333333335');
        `);
      }
      await db.exec(await readFile(new URL(name, migrationDir), "utf8"));
    } catch (error) {
      throw new Error(`Migration replay failed: ${name}`, { cause: error });
    }
  }
  assert.equal(
    (
      await db.query<{ csv_import_row_id: string }>(
        "select csv_import_row_id from financial_records where id='33333333-3333-4333-8333-333333333335'",
      )
    ).rows[0].csv_import_row_id,
    "33333333-3333-4333-8333-333333333336",
  );

  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  const category = (
    await db.query<{ id: string }>(
      "select id from record_categories where is_default and record_type='income' limit 1",
    )
  ).rows[0].id;
  const otherCategory = (
    await db.query<{ id: string }>(
      "insert into record_categories(user_id,name,record_type) values ($1,'Private category','income') returning id",
      [other],
    )
  ).rows[0].id;
  const imports = (
    await db.query<{ id: string }>(
      "insert into record_imports(user_id,source_type) values ($1,'csv'),($1,'bank_statement_pdf'),($2,'csv') returning id",
      [owner, other],
    )
  ).rows;

  async function stage(
    kind = "csv",
    amount = "1500.00",
    userId = owner,
    categoryId = category,
  ) {
    const table =
      kind === "csv" ? "csv_import_rows" : "bank_statement_import_rows";
    const importId =
      userId === other
        ? imports[2].id
        : kind === "csv"
          ? imports[0].id
          : imports[1].id;
    const extra = kind === "csv" ? ",raw_row" : ",redacted_line";
    const value = kind === "csv" ? ", '{}'::jsonb" : ", 'redacted evidence'";
    return (
      await db.query<{ id: string; updated_at: string }>(
        `insert into ${table}
      (user_id,import_id,row_number,record_type,record_date,description,amount,category_id,status${extra})
      values ($1,$2,1,'income','2026-04-05','Freelance work',$3,$4,'approved'${value})
      returning id, updated_at::text`,
        [userId, importId, amount, categoryId],
      )
    ).rows[0];
  }
  async function asUser(id: string | null) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? "",
    ]);
    await db.exec(id ? "set role authenticated" : "set role anon");
  }
  async function confirm(
    rows: { id: string; updated_at: string }[],
    kind = "csv",
  ) {
    return (
      await db.query<{ result: { committed: number; reused: number } }>(
        "select public.confirm_import_rows($1,$2::jsonb) as result",
        [kind, JSON.stringify(rows)],
      )
    ).rows[0].result;
  }
  async function count(table: string) {
    return (
      await db.query<{ n: number }>(`select count(*)::int n from ${table}`)
    ).rows[0].n;
  }

  await serialSubtest(t,
    "only reviewed IDs commit; replay does not duplicate; accounting year and audit agree",
    async () => {
      const selected = await stage();
      const unselected = await stage();
      await asUser(owner);
      assert.deepEqual(await confirm([selected]), { committed: 1, reused: 0 });
      assert.deepEqual(await confirm([selected]), { committed: 0, reused: 1 });
      assert.equal(await count("financial_records"), 1);
      assert.equal(await count("financial_record_changes"), 1);
      const pending = await db.query<{ status: string }>(
        "select status from csv_import_rows where id=$1",
        [unselected.id],
      );
      assert.equal(pending.rows[0].status, "approved");
      const posting = (
        await db.query<{ tax_year_start: number; amount: string }>(
          "select tax_year_start,amount::text from financial_records",
        )
      ).rows[0];
      assert.equal(posting.tax_year_start, 2025);
      assert.equal(posting.amount, "1500.00");
      await db.exec("reset role");
    },
  );

  await serialSubtest(t,
    "one invalid row rolls back all postings, review states and audit in the batch",
    async () => {
      const valid = await stage();
      const invalid = await stage("csv", "0.00");
      // Make valid sort first so the procedure actually writes before the injected failure.
      await db.query(
        "update csv_import_rows set amount=case when id=$1 then 1 else 0 end where id=any($2::uuid[])",
        [
          [valid, invalid].sort((a, b) => a.id.localeCompare(b.id))[0].id,
          [valid.id, invalid.id],
        ],
      );
      const rows = (
        await db.query<{ id: string; updated_at: string }>(
          "select id,updated_at::text from csv_import_rows where id=any($1::uuid[])",
          [[valid.id, invalid.id]],
        )
      ).rows;
      await asUser(owner);
      const before = await count("financial_records");
      const auditBefore = await count("financial_record_changes");
      await assert.rejects(confirm(rows), /valid and approved/);
      assert.equal(await count("financial_records"), before);
      assert.equal(await count("financial_record_changes"), auditBefore);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from csv_import_rows where id=any($1::uuid[]) and status='approved'",
            [[valid.id, invalid.id]],
          )
        ).rows[0].n,
        2,
      );
      await db.exec("reset role");
    },
  );

  await serialSubtest(t,
    "stale reviews, foreign rows and foreign categories cannot post",
    async () => {
      const own = await stage();
      const foreign = await stage("csv", "100.00", other);
      await assert.rejects(stage("csv", "100.00", owner, otherCategory), /Category must/);
      await asUser(owner);
      const before = await count("financial_records");
      await assert.rejects(
        confirm([{ ...own, updated_at: "2000-01-01T00:00:00Z" }]),
        /changed/,
      );
      await assert.rejects(confirm([own, foreign]), /missing or belong/);
      assert.equal(await count("financial_records"), before);
      assert.equal(
        (
          await db.query("select id from csv_import_rows where id=$1", [
            foreign.id,
          ])
        ).rows.length,
        0,
      );
      await asUser(other);
      assert.equal(await count("financial_records"), 0);
      await asUser(null);
      await assert.rejects(confirm([own]), /permission denied/);
      await db.exec("reset role");
    },
  );

  await serialSubtest(t,
    "bank row retries are safe and duplicate source postings are constrained",
    async () => {
      const row = await stage("bank_statement_pdf");
      await asUser(owner);
      assert.deepEqual(await confirm([row], "bank_statement_pdf"), {
        committed: 1,
        reused: 0,
      });
      assert.deepEqual(await confirm([row], "bank_statement_pdf"), {
        committed: 0,
        reused: 1,
      });
      await assert.rejects(
        db.query(
          `insert into financial_records(user_id,record_type,record_date,description,amount,bank_statement_row_id)
      values ($1,'income','2026-04-06','duplicate',1500,$2)`,
          [owner, row.id],
        ),
        /unique constraint/,
      );
      await db.exec("reset role");
    },
  );
  await serialSubtest(t,
    "preserved CSV ledger: dedupe, encrypted evidence, classification and isolation",
    async () => {
      await db.exec("reset role");
      const account = (
        await db.query<{ id: string }>(
          "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Test bank','starling','bank','1234') returning id",
          [owner],
        )
      ).rows[0].id;
      const foreignAccount = (
        await db.query<{ id: string }>(
          "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Other bank','starling','bank','5678') returning id",
          [other],
        )
      ).rows[0].id;
      const key = randomBytes(32);
      const csv =
        "Date,Description,Amount\n05/04/2026,Freelance receipt,1500.00\n06/04/2026,Repair,-630.29\n06/04/2026,Repair,-630.29\n06/04/2026,Personal Airbnb,-463.09";
      async function ingest(text = csv, acct = account, badRow = false) {
        await db.exec("reset role");
        const bytes = Buffer.from(text);
        const hash = sourceHash(bytes);
        const table = readSourceCsv(text);
        const mapping = suggestMapping(table[0], "starling");
        const rows = normalizeSourceCsv(table, mapping).map((r) => ({
          row_number: r.rowNumber,
          date: r.date,
          description: r.description,
          reference: r.reference,
          signed_pence: r.signedPence,
          currency: r.currency,
          row_hash: sourceHash(Buffer.from(JSON.stringify(r.rawCells))),
          raw_encrypted: encryptSource(
            Buffer.from(JSON.stringify(r.rawCells)),
            key,
            sourceContext(owner, acct, hash, r.rowNumber),
          ).toString("base64"),
          fingerprint: sourceHash(
            Buffer.from(JSON.stringify([r.date, r.signedPence, r.description])),
          ),
        }));
        if (badRow) rows.at(-1)!.currency = "EUR" as "GBP";
        const path = "test/" + crypto.randomUUID() + ".enc";
        const attempt = (
          await db.query<{ id: string }>(
            "insert into source_upload_attempts(user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'test',100,'uploaded') returning id",
            [owner, acct, hash, path],
          )
        ).rows[0].id;
        await db.query(
          "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
          [path],
        );
        await db.exec("set role service_role");
        return (
          await db.query<{
            result: {
              import_id: string;
              created: boolean;
              transactions: number;
            };
          }>(
            "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1',$3::jsonb,$4::jsonb) result",
            [owner, attempt, JSON.stringify(mapping), JSON.stringify(rows)],
          )
        ).rows[0].result;
      }
      const initial = await ingest();
      await db.exec("reset role");
      const beforeImportFinancials = await count("financial_records");
      assert.equal(initial.transactions, 4);
      const repeated = await ingest();
      assert.deepEqual(repeated, {
        import_id: initial.import_id,
        created: false,
        transactions: 0,
      });
      await db.exec("reset role");
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from bank_transactions where import_id=$1",
            [initial.import_id],
          )
        ).rows[0].n,
        4,
      );
      // Same-file identical purchases survive as separate observations.
      const tx = (
        await db.query<{
          id: string;
          signed_amount_pence: number;
          tax_year_start: number;
        }>(
          "select id,signed_amount_pence::float8,tax_year_start from bank_transactions where import_id=$1 order by source_row_id",
          [initial.import_id],
        )
      ).rows;
      assert.equal(
        tx.filter((x) => x.signed_amount_pence === -63029).length,
        2,
      );
      assert.equal(await count("financial_records"), beforeImportFinancials);
      const receipt = tx.find((x) => x.signed_amount_pence === 150000)!;
      const repair = tx.find((x) => x.signed_amount_pence === -63029)!;
      const personal = tx.find((x) => x.signed_amount_pence === -46309)!;
      assert.equal(receipt.tax_year_start, 2025);
      assert.equal(repair.tax_year_start, 2026);
      const expenseCategory = (
        await db.query<{ id: string }>(
          "select id from record_categories where is_default and record_type='expense' limit 1",
        )
      ).rows[0].id;
      const review = async (
        id: string,
        version: number,
        classification: string,
        bps: number,
        cat: string | null,
      ) =>
        (
          await db.query<{
            result: { recognized_pence: number; record_id: string };
          }>(
            "select review_bank_transaction($1,$2,$3,$4,$5,'Reviewed synthetic evidence') result",
            [id, version, classification, cat, bps],
          )
        ).rows[0].result;
      await asUser(owner);
      // An owned account/hash cannot be used to poison dedupe by fabricating provenance.
      await assert.rejects(
        db.query(
          "insert into record_imports(user_id,source_type,account_id,file_hash) values ($1,'csv',$2,$3)",
          [owner, account, "c".repeat(64)],
        ),
        /server ingestion/,
      );
      const legacy = (
        await db.query<{ id: string }>(
          "insert into record_imports(user_id,source_type) values ($1,'csv') returning id",
          [owner],
        )
      ).rows[0].id;
      await assert.rejects(
        db.query(
          "update record_imports set account_id=$1,file_hash=$2 where id=$3",
          [account, "d".repeat(64), legacy],
        ),
        /server ingestion/,
      );
      await assert.rejects(
        db.query(
          "insert into financial_records(user_id,record_type,record_date,description,amount,import_id) values ($1,'income','2026-02-01','Forged source posting',1,$2)",
          [owner, initial.import_id],
        ),
        /reviewed classification/,
      );
      assert.equal(
        (await review(receipt.id, 0, "Business", 10000, category))
          .recognized_pence,
        150000,
      );
      assert.equal(
        (await review(repair.id, 0, "Mixed", 3000, expenseCategory))
          .recognized_pence,
        18909,
      );
      assert.equal(
        (await review(personal.id, 0, "Personal", 0, null)).recognized_pence,
        0,
      );
      await assert.rejects(
        review(receipt.id, 0, "Business", 10000, category),
        /changed/,
      );
      await assert.rejects(
        db.query(
          "select review_bank_transaction($1,null,'Business',$2,10000,'bad version')",
          [receipt.id, category],
        ),
        /changed/,
      );
      assert.equal(
        (await review(repair.id, 1, "Personal", 0, null)).recognized_pence,
        0,
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from financial_records where bank_transaction_id=$1",
            [repair.id],
          )
        ).rows[0].status,
        "excluded",
      );
      assert.equal(
        (await review(repair.id, 2, "Mixed", 3000, expenseCategory))
          .recognized_pence,
        18909,
      );
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from financial_records where bank_transaction_id=$1",
            [repair.id],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        db.query(
          "update financial_records set amount=1 where bank_transaction_id=$1",
          [repair.id],
        ),
        /reviewed classification/,
      );
      // The reciprocal transaction FK also protects canonical postings from deletion.
      await assert.rejects(
        db.query("delete from financial_records where bank_transaction_id=$1", [
          repair.id,
        ]),
        /foreign key constraint|reviewed classification/,
      );
      await assert.rejects(
        db.query(
          "update bank_transactions set signed_amount_pence=1 where id=$1",
          [repair.id],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select raw_encrypted from source_rows"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from record_source_files"),
        /permission denied/,
      );
      assert.equal(
        (
          await db.query(
            "select * from storage.objects where bucket_id='source-evidence'",
          )
        ).rows.length,
        0,
      );
      await asUser(other);
      assert.equal(
        (
          await db.query("select * from bank_transactions where import_id=$1", [
            initial.import_id,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        review(receipt.id, 1, "Business", 10000, category),
        /not found/,
      );
      await asUser(null);
      await assert.rejects(
        review(receipt.id, 1, "Business", 10000, category),
        /permission denied/,
      );
      await db.exec("reset role");
      await assert.rejects(
        db.query(
          "update source_rows set row_hash=repeat('b',64) where import_id=$1",
          [initial.import_id],
        ),
        /immutable/,
      );
      await assert.rejects(
        db.query(
          "delete from classification_decisions where transaction_id=$1",
          [repair.id],
        ),
        /immutable/,
      );
      await assert.rejects(
        db.query("delete from record_imports where id=$1", [initial.import_id]),
        /cannot be deleted/,
      );
      await assert.rejects(
        db.query(
          "update bank_transactions set description='changed' where id=$1",
          [repair.id],
        ),
        /immutable/,
      );
      const counts = await count("bank_transactions");
      await assert.rejects(
        ingest(csv + "\n07/04/2026,Bad currency,-1.00", account, true),
        /currency/,
      );
      await db.exec("reset role");
      assert.equal(await count("bank_transactions"), counts);
      await assert.rejects(ingest(csv, foreignAccount), /foreign key/);
      const overlap = await ingest(
        csv + "\n07/04/2026,Additional receipt,50.00",
      );
      await db.exec("reset role");
      const candidate = (
        await db.query<{ id: string }>(
          "select id from bank_transactions where import_id=$1 and dedupe_status='needs_review' limit 1",
          [overlap.import_id],
        )
      ).rows[0];
      assert.ok(candidate);
      await asUser(owner);
      await assert.rejects(
        review(candidate.id, 0, "Business", 10000, category),
        /possible duplicates/,
      );
      await asUser(owner);
      const summary = (
        await db.query<{
          s: { stamp: string; income_pence: number; expense_pence: number };
        }>("select source_import_summary($1) s", [initial.import_id])
      ).rows[0].s;
      assert.equal(Number(summary.income_pence), 150000);
      assert.equal(Number(summary.expense_pence), 18909);
      await assert.rejects(
        db.query("update record_imports set status='discarded' where id=$1", [
          initial.import_id,
        ]),
        /reviewed action/,
      );
      await assert.rejects(
        db.query("select reverse_source_import($1,'stale','Wrong preview')", [
          initial.import_id,
        ]),
        /changed/,
      );
      const beforeReverse = (
        await db.query<{ n: number }>(
          "select count(*)::int n from source_rows where import_id=$1",
          [initial.import_id],
        )
      ).rows[0].n;
      await db.query(
        "select reverse_source_import($1,$2,'Synthetic rollback test')",
        [initial.import_id, summary.stamp],
      );
      const reversed = (
        await db.query<{ s: { income_pence: number; expense_pence: number } }>(
          "select source_import_summary($1) s",
          [initial.import_id],
        )
      ).rows[0].s;
      assert.equal(Number(reversed.income_pence), 0);
      assert.equal(Number(reversed.expense_pence), 0);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from source_rows where import_id=$1",
            [initial.import_id],
          )
        ).rows[0].n,
        beforeReverse,
      );
      await assert.rejects(
        review(receipt.id, 2, "Business", 10000, category),
        /reversed/,
      );
      const reimportAfterReversal = await ingest();
      assert.equal(reimportAfterReversal.created, false);
      await asUser(owner);
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from record_imports where id=$1",
            [initial.import_id],
          )
        ).rows[0].status,
        "discarded",
      );
      await db.query("select reopen_source_import($1)", [initial.import_id]);
      assert.equal(
        (
          await db.query<{ s: { income_pence: number } }>(
            "select source_import_summary($1) s",
            [initial.import_id],
          )
        ).rows[0].s.income_pence,
        0,
      );
      assert.equal(
        (await review(receipt.id, 2, "Business", 10000, category))
          .recognized_pence,
        150000,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from record_source_files where user_id=$1",
            [owner],
          )
        ).rows[0].n,
        2,
      );
    },
  );
});
