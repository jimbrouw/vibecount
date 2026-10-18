import {canonicalJson} from '../tax/snapshot.ts';
import {buildFilingPack,buildFilingReview,type FilingPackInput,type StepReview} from '../tax/filing-pack.ts';
import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
import {prepareCalculation} from '../tax/snapshot.ts';
import type {CalculationInput} from '../tax/calculation.ts';
import {financeFixture} from '../finance/test-fixture.ts';
import {londonPlanningDate} from '../finance/defaults.ts';
import {prepareBankCoveredFinancePlan} from '../finance/snapshot.ts';
import type {PlanContext} from '../finance/server.ts';
import {emptyFinancePlan} from '../finance/defaults.ts';
import {deadlineCatalogFromPlan,prepareDeadlineSnapshot} from '../finance/deadlines/snapshot.ts';
import {emptyDeadlinePlan} from '../finance/deadlines/model.ts';
import {refundReversalClosure} from '../records/refund-closure.ts';

test(
  "native PostgreSQL serializes overlapping imports and concurrent approval",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "vibecount-pg-test-"));
    const port = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once("error", reject);
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address();
        if (!address || typeof address === "string") {
          socket.close();
          reject(new Error("No test port"));
          return;
        }
        socket.close(() => resolve(address.port));
      });
    });
    const cluster = new EmbeddedPostgres({
      databaseDir: join(directory, "data"),
      port,
      user: "postgres",
      password: randomBytes(24).toString("hex"),
      persistent: false,
      createPostgresUser: false,
      postgresFlags: [
        "-c",
        "listen_addresses=127.0.0.1",
        "-c",
        `unix_socket_directories=${directory}`,
      ],
      onLog: () => {},
      onError: () => {},
    });
    let started = false;
    const clients: ReturnType<typeof cluster.getPgClient>[] = [];
    t.after(async () => {
      for (const client of clients) await client.end().catch(() => {});
      if (started) await cluster.stop();
      await rm(directory, { recursive: true, force: true });
    });
    await cluster.initialise();
    await cluster.start();
    started = true;
    const admin = cluster.getPgClient("postgres", "127.0.0.1");
    clients.push(admin);
    await admin.connect();
    await admin.query(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await admin.query(await readFile(new URL(name, dir), "utf8"));
    const owner = randomUUID();
    await admin.query("insert into auth.users(id) values ($1)", [owner]);
    const account = (
      await admin.query(
        "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Concurrency fixture','starling','bank','1234') returning id",
        [owner],
      )
    ).rows[0].id;
    const first = cluster.getPgClient("postgres", "127.0.0.1"),
      second = cluster.getPgClient("postgres", "127.0.0.1");
    clients.push(first, second);
    await first.connect();
    await second.connect();
    const secondPid = (await second.query("select pg_backend_pid() pid"))
      .rows[0].pid;
    await first.query("set role service_role");
    await second.query("set role service_role");

    async function attempt(hash: string, accountId = account) {
      const path = `fixture/${randomUUID()}.enc`;
      const id = (
        await admin.query(
          "insert into source_upload_attempts(user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'test',100,'uploaded') returning id",
          [owner, accountId, hash, path],
        )
      ).rows[0].id;
      await admin.query(
        "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
        [path],
      );
      return id;
    }
    const rows = JSON.stringify([
      {
        row_number: 2,
        row_hash: "a".repeat(64),
        raw_encrypted: "synthetic-ciphertext",
        date: "2026-02-01",
        signed_pence: 150000,
        currency: "GBP",
        description: "Freelance receipt",
        reference: "INV-1",
        fingerprint: "b".repeat(64),
      },
    ]);
    const ingestSql =
      "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}'::jsonb,$3::jsonb) result";
    async function waitsForLock() {
      for (let i = 0; i < 200; i++) {
        const state = (
          await admin.query(
            "select wait_event_type from pg_stat_activity where pid=$1",
            [secondPid],
          )
        ).rows[0];
        if (state?.wait_event_type === "Lock") return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    }
    await serialSubtest(t,
      "overlapping but byte-different files cannot both bypass duplicate review",
      async () => {
        const a = await attempt("1".repeat(64)),
          b = await attempt("2".repeat(64));
        await first.query("begin");
        await first.query(ingestSql, [owner, a, rows]);
        const pending = second.query(ingestSql, [owner, b, rows]);
        pending.catch(() => {});
        const locked = await waitsForLock();
        await first.query("commit");
        await pending;
        assert.equal(
          locked,
          true,
          "Second overlapping import must wait for the account lock",
        );
        const statuses = (
          await admin.query(
            "select dedupe_status from bank_transactions order by dedupe_status",
          )
        ).rows.map((r: { dedupe_status: string }) => r.dedupe_status);
        assert.deepEqual(statuses, ["clear", "needs_review"]);
        assert.equal(
          (await admin.query("select count(*)::int n from financial_records"))
            .rows[0].n,
          0,
        );
      },
    );
    await serialSubtest(t,
      "concurrent same-file retries reuse the canonical import",
      async () => {
        const a = await attempt("3".repeat(64)),
          b = await attempt("3".repeat(64));
        await first.query("begin");
        const original = (await first.query(ingestSql, [owner, a, rows]))
          .rows[0].result;
        const pending = second.query(ingestSql, [owner, b, rows]);
        pending.catch(() => {});
        const locked = await waitsForLock();
        await first.query("commit");
        const repeated = (await pending).rows[0].result;
        assert.equal(locked, true);
        assert.equal(repeated.created, false);
        assert.equal(repeated.transactions, 0);
        assert.equal(repeated.import_id, original.import_id);
      },
    );
    await serialSubtest(t,
      "two confirmations of the same review version create one posting and one decision",
      async () => {
        await first.query("reset role");
        await second.query("reset role");
        for (const client of [first, second]) {
          await client.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          );
          await client.query("set role authenticated");
        }
        const id = (
          await admin.query(
            "select id from bank_transactions where dedupe_status='clear' limit 1",
          )
        ).rows[0].id;
        const category = (
          await admin.query(
            "select id from record_categories where is_default and record_type='income' limit 1",
          )
        ).rows[0].id;
        const sql =
          "select review_bank_transaction($1,0,'Business',$2,10000,'Human reviewed concurrency fixture')";
        await first.query("begin");
        await first.query(sql, [id, category]);
        const pending = second.query(sql, [id, category]);
        pending.catch(() => {});
        const locked = await waitsForLock();
        await first.query("commit");
        assert.equal(locked, true);
        await assert.rejects(pending, /changed/);
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from financial_records where bank_transaction_id=$1",
              [id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from classification_decisions where transaction_id=$1",
              [id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await serialSubtest(t,
      "concurrent document reimports preserve one canonical batch",
      async () => {
        for (const client of [first, second])
          await client.query("reset role; set role service_role");
        async function documentAttempt() {
          const id = randomUUID();
          const path = `${owner}/${id}/0.enc`;
          await admin.query(
            "insert into storage.objects(bucket_id,name) values ('document-evidence',$1)",
            [path],
          );
          await admin.query(
            "insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values ($1,$2,$3,'uploaded',$4::jsonb)",
            [
              id,
              owner,
              "8".repeat(64),
              JSON.stringify([
                {
                  hash: "8".repeat(64),
                  path,
                  key_id: "test",
                  size: 100,
                  media_type: "application/pdf",
                  name_encrypted: "ciphertext",
                },
              ]),
            ],
          );
          return id;
        }
        const a = await documentAttempt(),
          b = await documentAttempt();
        const sql =
          "select register_document_intake($1,$2,2025,'employment','opaque-evidence/1') result";
        await first.query("begin");
        const original = (await first.query(sql, [owner, a])).rows[0].result;
        const pending = second.query(sql, [owner, b]);
        pending.catch(() => {});
        const locked = await waitsForLock();
        await first.query("commit");
        const repeat = (await pending).rows[0].result;
        assert.equal(locked, true);
        assert.equal(repeat.created, false);
        assert.equal(repeat.batch_id, original.batch_id);
        assert.equal(
          (await admin.query("select count(*)::int n from document_batches"))
            .rows[0].n,
          1,
        );
        assert.equal(
          (await admin.query("select count(*)::int n from evidence_documents"))
            .rows[0].n,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from document_intake_events",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await serialSubtest(t,"native allocation concurrency invariants", async (t) => {
      const receipt = (
        await admin.query(
          "select id from bank_transactions where classification='Business' and dedupe_status='clear' limit 1",
        )
      ).rows[0].id;
      const client = (
        await admin.query(
          "insert into clients(user_id,name) values ($1,'Native reconciliation fixture') returning id",
          [owner],
        )
      ).rows[0].id;
      const invoiceIds: string[] = [];
      for (const number of ["NATIVE-A", "NATIVE-B", "NATIVE-C"])
        invoiceIds.push(
          (
            await admin.query(
              "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,$3,'Synthetic native test',200,'finalised') returning id",
              [owner, client, number],
            )
          ).rows[0].id,
        );
      for (const connection of [first, second]) {
        await connection.query("reset role");
        await connection.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [owner],
        );
        await connection.query("set role authenticated");
      }
      async function allocationEntry(invoice: string, amount: number) {
        return JSON.stringify([
          {
            invoice_id: invoice,
            amount_pence: amount,
            invoice_updated_at: (
              await admin.query(
                "select updated_at::text version from invoices where id=$1",
                [invoice],
              )
            ).rows[0].version,
          },
        ]);
      }
      const allocateSql =
        "select approve_invoice_allocations($1,1,$2::jsonb,'Native human-reviewed match',$3,$4) result";
      await serialSubtest(t,
        "concurrent matches cannot change a confirmed receipt remainder",
        async () => {
          const a = await allocationEntry(invoiceIds[0], 10000),
            b = await allocationEntry(invoiceIds[1], 10000);
          await first.query("begin");
          await first.query(allocateSql, [receipt, a, randomUUID(), 0]);
          const pending = second.query(allocateSql, [
            receipt,
            b,
            randomUUID(),
            0,
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /Receipt allocations changed/);
        },
      );
      await serialSubtest(t,
        "invoice edits waiting behind an allocation see committed history and cannot change payable",
        async () => {
          const entry = await allocationEntry(invoiceIds[1], 10000);
          await first.query("begin");
          await first.query(allocateSql, [receipt, entry, randomUUID(), 10000]);
          const pending = second.query(
            "update invoices set amount=1 where id=$1",
            [invoiceIds[1]],
          );
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /reviewed correction/);
          assert.equal(
            (
              await admin.query(
                "select amount::float8 from invoices where id=$1",
                [invoiceIds[1]],
              )
            ).rows[0].amount,
            200,
          );
        },
      );
      await serialSubtest(t,
        "different receipts cannot concurrently overpay the same invoice",
        async () => {
          const newAttempt = await attempt("9".repeat(64));
          const newRows = JSON.parse(rows);
          newRows[0].signed_pence = 20000;
          newRows[0].fingerprint = "c".repeat(64);
          const imported = (
            await admin.query(ingestSql, [
              owner,
              newAttempt,
              JSON.stringify(newRows),
            ])
          ).rows[0].result;
          const secondReceipt = (
            await admin.query(
              "select id from bank_transactions where import_id=$1",
              [imported.import_id],
            )
          ).rows[0].id;
          const category = (
            await admin.query(
              "select id from record_categories where is_default and record_type='income' limit 1",
            )
          ).rows[0].id;
          await second.query(
            "select review_bank_transaction($1,0,'Business',$2,10000,'Human reviewed native receipt')",
            [secondReceipt, category],
          );
          const entry = await allocationEntry(invoiceIds[2], 20000);
          await first.query("begin");
          await first.query(allocateSql, [receipt, entry, randomUUID(), 20000]);
          const pending = second.query(allocateSql, [
            secondReceipt,
            entry,
            randomUUID(),
            0,
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /Invoice changed|outstanding/);
          assert.equal(
            (
              await admin.query(
                "select allocated_pence::float8 from invoice_payment_balances where id=$1",
                [invoiceIds[2]],
              )
            ).rows[0].allocated_pence,
            20000,
          );
        },
      );
    });
    await serialSubtest(t,"native paired-transfer concurrency invariants", async (t) => {
      const otherAccount = (
        await admin.query(
          "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Native transfer bank','generic','bank','5678') returning id",
          [owner],
        )
      ).rows[0].id;
      for (const connection of [first, second]) {
        await connection.query("reset role");
        await connection.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [owner],
        );
        await connection.query("set role authenticated");
      }
      async function seed(accountId: string, hash: string, amounts: number[]) {
        const sourceAttempt = await attempt(hash.repeat(64), accountId);
        const sourceRows = amounts.map((amount, i) => ({
          row_number: i + 2,
          row_hash: String(i + 1).padStart(64, "0"),
          raw_encrypted: "synthetic",
          date: "2026-02-01",
          signed_pence: amount,
          currency: "GBP",
          description: "Native synthetic transfer",
          reference: "",
          fingerprint: (hash + String(i)).padStart(64, "0"),
        }));
        const imported = (
          await admin.query(ingestSql, [
            owner,
            sourceAttempt,
            JSON.stringify(sourceRows),
          ])
        ).rows[0].result;
        return (
          await admin.query(
            "select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number",
            [imported.import_id],
          )
        ).rows.map((row: { id: string }) => row.id);
      }
      const out = await seed(account, "a", [-10000, -20000, -30000]);
      const incoming = await seed(
        otherAccount,
        "b",
        [10000, 10000, 20000, 30000],
      );
      const pairSql =
        "select approve_transfer_pair($1,$2,$3,$4,'transfer','Reviewed native pair',$5) result";
      await serialSubtest(t,
        "two concurrent pairs cannot consume the same outgoing transaction",
        async () => {
          await first.query("begin");
          await first.query(pairSql, [out[0], 0, incoming[0], 0, randomUUID()]);
          const pending = second.query(pairSql, [
            out[0],
            0,
            incoming[1],
            0,
            randomUUID(),
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /decisions changed|active transfer/);
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from bank_transactions where active_transfer_id is not null",
              )
            ).rows[0].n,
            2,
          );
        },
      );
      await serialSubtest(t,
        "classification waiting behind a pair cannot create counterpart income",
        async () => {
          const category = (
            await admin.query(
              "select id from record_categories where is_default and record_type='income' limit 1",
            )
          ).rows[0].id;
          await first.query("begin");
          await first.query(pairSql, [out[1], 0, incoming[2], 0, randomUUID()]);
          const pending = second.query(
            "select review_bank_transaction($1,0,'Business',$2,10000,'Concurrent reclassification')",
            [incoming[2], category],
          );
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /Reverse the transfer pair/);
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from financial_records where bank_transaction_id=$1 and status='approved'",
                [incoming[2]],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await serialSubtest(t,
        "invoice allocation wins atomically or transfer pairing wins, never both",
        async () => {
          const category = (
            await admin.query(
              "select id from record_categories where is_default and record_type='income' limit 1",
            )
          ).rows[0].id;
          await first.query(
            "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed receipt')",
            [incoming[3], category],
          );
          const client = (
            await admin.query(
              "insert into clients(user_id,name) values ($1,'Native transfer allocation fixture') returning id",
              [owner],
            )
          ).rows[0].id;
          const invoice = (
            await admin.query(
              "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,'NATIVE-TRANSFER','Synthetic native invoice',300,'finalised') returning id,updated_at::text version",
              [owner, client],
            )
          ).rows[0];
          await first.query("begin");
          await first.query(
            "select approve_invoice_allocations($1,1,$2::jsonb,'Reviewed invoice match',$3,0)",
            [
              incoming[3],
              JSON.stringify([
                {
                  invoice_id: invoice.id,
                  amount_pence: 30000,
                  invoice_updated_at: invoice.version,
                },
              ]),
              randomUUID(),
            ],
          );
          const pending = second.query(pairSql, [
            out[2],
            0,
            incoming[3],
            1,
            randomUUID(),
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /Reverse invoice allocations/);
          assert.equal(
            (
              await admin.query(
                "select active_transfer_id from bank_transactions where id=$1",
                [incoming[3]],
              )
            ).rows[0].active_transfer_id,
            null,
          );
          assert.equal(
            (
              await admin.query(
                "select allocated_pence::float8 from invoice_payment_balances where id=$1",
                [invoice.id],
              )
            ).rows[0].allocated_pence,
            30000,
          );
        },
      );
    });
    await serialSubtest(t,
      "native invoice revision concurrency invariants",
      async (t) => {
        for (const connection of [first, second]) {
          await connection.query("reset role");
          await connection.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          );
          await connection.query("set role authenticated");
        }
        const client = (
          await admin.query(
            "insert into clients(user_id,name) values ($1,'Native invoice revision fixture') returning id",
            [owner],
          )
        ).rows[0].id;
        const sourceAttempt = await attempt(randomBytes(32).toString("hex"));
        const imported = (
          await admin.query(ingestSql, [
            owner,
            sourceAttempt,
            JSON.stringify([
              {
                row_number: 2,
                row_hash: "e".repeat(64),
                raw_encrypted: "synthetic",
                date: "2026-03-01",
                signed_pence: 10000,
                currency: "GBP",
                description: "Native invoice receipt",
                reference: "",
                fingerprint: randomBytes(32).toString("hex"),
              },
            ]),
          ])
        ).rows[0].result;
        const receipt = (
          await admin.query(
            "select id from bank_transactions where import_id=$1",
            [imported.import_id],
          )
        ).rows[0].id;
        const category = (
          await admin.query(
            "select id from record_categories where is_default and record_type='income' limit 1",
          )
        ).rows[0].id;
        await first.query(
          "select review_bank_transaction($1,0,'Business',$2,10000,'Native reviewed receipt')",
          [receipt, category],
        );
        const saveSql =
          "select save_invoice_revision($1,$2,$3,$4::jsonb,$5,$6) result";
        async function fixture(number: string) {
          const inv = (
            await admin.query(
              "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,$3,'Native legacy invoice',100,'finalised') returning id,updated_at::text version",
              [owner, client, number],
            )
          ).rows[0];
          const revision = randomUUID();
          const path = `${owner}/revisions/${revision}.pdf`;
          await admin.query(
            "insert into storage.objects(bucket_id,name) values ('invoices',$1)",
            [path],
          );
          const data = {
            client_id: client,
            number,
            invoice_date: "2026-03-01",
            due_date: "2026-03-31",
            description: "Native reviewed invoice",
            payment_terms: "30 days",
            net_pence: 10000,
            vat_pence: 0,
            vat_rate_bps: 0,
            vat_enabled: false,
            vat_number: "",
            legacy_confirmed: true,
            reason: "Verified original",
          };
          return {
            inv,
            args: [
              inv.id,
              revision,
              inv.version,
              JSON.stringify(data),
              path,
              "a".repeat(64),
            ],
          };
        }
        await serialSubtest(t,
          "two revision saves serialize and reject the stale review",
          async () => {
            const f = await fixture("NATIVE-REV-1");
            const otherRevision = randomUUID();
            const otherPath = `${owner}/revisions/${otherRevision}.pdf`;
            await admin.query(
              "insert into storage.objects(bucket_id,name) values ('invoices',$1)",
              [otherPath],
            );
            await first.query("begin");
            await first.query(saveSql, f.args);
            const pending = second.query(saveSql, [
              f.inv.id,
              otherRevision,
              f.inv.version,
              f.args[3],
              otherPath,
              "b".repeat(64),
            ]);
            pending.catch(() => {});
            const locked = await waitsForLock();
            await first.query("commit");
            assert.equal(locked, true);
            await assert.rejects(pending, /Invoice changed/);
            assert.equal(
              (
                await admin.query(
                  "select economics_version from invoices where id=$1",
                  [f.inv.id],
                )
              ).rows[0].economics_version,
              1,
            );
          },
        );
        await serialSubtest(t,
          "allocation ahead of revision prevents an evidence rewrite",
          async () => {
            const f = await fixture("NATIVE-REV-2");
            await first.query("begin");
            await first.query(
              "select approve_invoice_allocations($1,1,$2::jsonb,'Native reviewed allocation',$3,0)",
              [
                receipt,
                JSON.stringify([
                  {
                    invoice_id: f.inv.id,
                    invoice_updated_at: f.inv.version,
                    amount_pence: 10000,
                  },
                ]),
                randomUUID(),
              ],
            );
            const pending = second.query(saveSql, f.args);
            pending.catch(() => {});
            const locked = await waitsForLock();
            await first.query("commit");
            assert.equal(locked, true);
            await assert.rejects(pending, /Invoice changed|settlement history/);
            assert.equal(
              (
                await admin.query(
                  "select economics_version from invoices where id=$1",
                  [f.inv.id],
                )
              ).rows[0].economics_version,
              0,
            );
          },
        );
      },
    );
    await serialSubtest(t,"native refund concurrency invariants", async (t) => {
      for (const connection of [first, second]) {
        await connection.query("reset role");
        await connection.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [owner],
        );
        await connection.query("set role authenticated");
      }
      const sourceAttempt = await attempt(randomBytes(32).toString("hex"));
      const imported = (
        await admin.query(ingestSql, [
          owner,
          sourceAttempt,
          JSON.stringify(
            [-10000, 8000, 8000, 2000].map((amount, i) => ({
              row_number: i + 2,
              row_hash: randomBytes(32).toString("hex"),
              raw_encrypted: "synthetic",
              date: i === 0 ? "2026-04-05" : "2026-04-06",
              signed_pence: amount,
              currency: "GBP",
              description: "Native synthetic refund",
              reference: "",
              fingerprint: randomBytes(32).toString("hex"),
            })),
          ),
        ])
      ).rows[0].result;
      const tx = (
        await admin.query(
          "select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number",
          [imported.import_id],
        )
      ).rows.map((r: { id: string }) => r.id);
      const category = (
        await admin.query(
          "select id from record_categories where is_default and record_type='expense' limit 1",
        )
      ).rows[0].id;
      await first.query(
        "select review_bank_transaction($1,0,'Business',$2,10000,'Native original payment')",
        [tx[0], category],
      );
      const stamp = (
        await first.query("select refund_group_stamp($1) s", [tx[0]])
      ).rows[0].s;
      const sql =
        "select approve_refund($1,1,$2,0,$3,'Native refund review',$4) result";
      await serialSubtest(t,
        "two simultaneous partial refunds cannot exceed original capacity",
        async () => {
          await first.query("begin");
          await first.query(sql, [tx[0], tx[1], stamp, randomUUID()]);
          const pending = second.query(sql, [
            tx[0],
            tx[2],
            stamp,
            randomUUID(),
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /decisions changed/);
          const fresh = (
            await second.query("select refund_group_stamp($1) s", [tx[0]])
          ).rows[0].s;
          await assert.rejects(
            second.query(sql, [tx[0], tx[2], fresh, randomUUID()]),
            /exceeds remaining/,
          );
          assert.equal(
            (
              await admin.query(
                "select sum(recognized_pence)::float8 n from active_refunds where original_transaction_id=$1",
                [tx[0]],
              )
            ).rows[0].n,
            8000,
          );
        },
      );
      await serialSubtest(t,
        "original reclassification waits behind approval and cannot invalidate reductions",
        async () => {
          const fresh = (
            await first.query("select refund_group_stamp($1) s", [tx[0]])
          ).rows[0].s;
          await first.query("begin");
          await first.query(sql, [tx[0], tx[3], fresh, randomUUID()]);
          const pending = second.query(
            "select review_bank_transaction($1,1,'Personal',null,0,'Concurrent original change')",
            [tx[0]],
          );
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /refund group/);
          assert.equal(
            (
              await admin.query(
                "select sum(recognized_pence)::float8 n from active_refunds where original_transaction_id=$1",
                [tx[0]],
              )
            ).rows[0].n,
            10000,
          );
        },
      );
    });
    await serialSubtest(t,
      "native credit approval and receipt allocation serialize in either order",
      async () => {
        for (const creditFirst of [true, false]) {
          for (const connection of [first, second]) {
            await connection.query("reset role");
            await connection.query(
              "select set_config('request.jwt.claim.sub',$1,false)",
              [owner],
            );
            await connection.query("set role authenticated");
          }
          const sourceAttempt = await attempt(randomBytes(32).toString("hex"));
          const imported = (
            await admin.query(ingestSql, [
              owner,
              sourceAttempt,
              JSON.stringify([
                {
                  row_number: 2,
                  row_hash: randomBytes(32).toString("hex"),
                  raw_encrypted: "synthetic",
                  date: "2026-04-05",
                  signed_pence: 10000,
                  currency: "GBP",
                  description: "Native credit receipt",
                  reference: "",
                  fingerprint: randomBytes(32).toString("hex"),
                },
              ]),
            ])
          ).rows[0].result;
          const tx = (
            await admin.query(
              "select id from bank_transactions where import_id=$1",
              [imported.import_id],
            )
          ).rows[0].id;
          const client = (
            await admin.query(
              "insert into clients(user_id,name) values ($1,$2) returning id",
              [owner, "Synthetic credit client " + randomUUID()],
            )
          ).rows[0].id;
          const invoice = (
            await admin.query(
              "insert into invoices(user_id,client_id,number,invoice_date,description,amount,status) values ($1,$2,$3,'2026-04-05','Synthetic credit supply',100,'finalised') returning id,number",
              [owner, client, "NATIVE-" + randomUUID()],
            )
          ).rows[0];
          const category = (
            await admin.query(
              "select id from record_categories where is_default and record_type='income' limit 1",
            )
          ).rows[0].id;
          await first.query(
            "select review_bank_transaction($1,0,'Business',$2,10000,'Native credit review')",
            [tx, category],
          );
          const b = (
            await first.query(
              "select b.*,b.updated_at::text updated_at from invoice_credit_choices b where id=$1",
              [invoice.id],
            )
          ).rows[0];
          const credit = randomUUID(),
            path = owner + "/credits/" + credit + ".pdf";
          await admin.query(
            "insert into storage.objects(bucket_id,name) values ('invoices',$1)",
            [path],
          );
          const document = {
            number: "CN-" + invoice.number + "-001",
            creditDate: "2026-04-06",
            invoiceNumber: invoice.number,
            invoiceDate: "2026-04-05",
            description: "Synthetic credit supply",
            sellerName: "Synthetic supplier",
            sellerAddress: "",
            clientName: "Synthetic client",
            clientAddress: "",
            reason: "Native credit",
            grossPence: 7000,
            netPence: null,
            vatPence: null,
            taxStatus: "unverified",
            vatRateBps: null,
            vatNumber: "",
            reviewHash: "b".repeat(64),
          };
          const creditSql =
            "select approve_invoice_credit($1,$2,$3,'2026-04-06',7000,'Native credit',$4::jsonb,$5,$6)";
          const creditArgs = [
            invoice.id,
            credit,
            b.balance_stamp,
            JSON.stringify(document),
            path,
            "c".repeat(64),
          ];
          const allocSql =
            "select approve_invoice_allocations($1,1,$2::jsonb,'Native match',$3,0)";
          const allocArgs = [
            tx,
            JSON.stringify([
              {
                invoice_id: invoice.id,
                invoice_updated_at: b.updated_at,
                amount_pence: 5000,
              },
            ]),
            randomUUID(),
          ];
          await first.query("begin");
          await first.query(
            creditFirst ? creditSql : allocSql,
            creditFirst ? creditArgs : allocArgs,
          );
          const pending = second.query(
            creditFirst ? allocSql : creditSql,
            creditFirst ? allocArgs : creditArgs,
          );
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          await assert.rejects(pending, /Invoice changed|balance changed/);
          const after = (
            await admin.query(
              "select b.*,b.updated_at::text updated_at from invoice_payment_balances b where id=$1",
              [invoice.id],
            )
          ).rows[0];
          assert.equal(Number(after.credited_pence), creditFirst ? 7000 : 0);
          assert.equal(Number(after.allocated_pence), creditFirst ? 0 : 5000);
          assert.equal(
            Number(after.outstanding_pence),
            creditFirst ? 3000 : 5000,
          );
          if (creditFirst) {
            const freshArgs = [
              tx,
              JSON.stringify([
                {
                  invoice_id: invoice.id,
                  invoice_updated_at: after.updated_at,
                  amount_pence: 5000,
                },
              ]),
              randomUUID(),
            ];
            await assert.rejects(
              second.query(allocSql, freshArgs),
              /outstanding/,
            );
          }
          if (!creditFirst) {
            const freshCreditStamp = (
              await first.query("select invoice_balance_stamp($1) s", [
                invoice.id,
              ])
            ).rows[0].s;
            const freshCreditArgs = [...creditArgs];
            freshCreditArgs[2] = freshCreditStamp;
            await first.query(creditSql, freshCreditArgs);
            const refundAttempt = await attempt(
              randomBytes(32).toString("hex"),
            );
            const refundImport = (
              await admin.query(ingestSql, [
                owner,
                refundAttempt,
                JSON.stringify([
                  {
                    row_number: 2,
                    row_hash: randomBytes(32).toString("hex"),
                    raw_encrypted: "synthetic",
                    date: "2026-04-06",
                    signed_pence: -4000,
                    currency: "GBP",
                    description: "Native cash return",
                    reference: "",
                    fingerprint: randomBytes(32).toString("hex"),
                  },
                ]),
              ])
            ).rows[0].result.import_id;
            const returned = (
              await admin.query(
                "select id from bank_transactions where import_id=$1",
                [refundImport],
              )
            ).rows[0].id;
            const group = (
              await first.query("select refund_group_stamp($1) s", [tx])
            ).rows[0].s;
            await first.query(
              "select approve_refund($1,1,$2,0,$3,'Native returned cash',$4)",
              [tx, returned, group, randomUUID()],
            );
            const refundId = (
              await admin.query(
                "select id from active_refunds where refund_transaction_id=$1",
                [returned],
              )
            ).rows[0].id;
            const allocationId = (
              await admin.query(
                "select id from active_invoice_allocations where invoice_id=$1",
                [invoice.id],
              )
            ).rows[0].id;
            const readStamp = async () =>
              (await first.query("select reconciliation_export_stamp() s"))
                .rows[0].s;
            const assignSql =
              "select approve_invoice_refund_assignment($1,$2,$3,$4,$5,'Native return assignment',$6)";
            const stamp = await readStamp();
            await first.query("begin");
            await first.query(assignSql, [
              credit,
              allocationId,
              refundId,
              3000,
              stamp,
              randomUUID(),
            ]);
            const pending = second.query(assignSql, [
              credit,
              allocationId,
              refundId,
              3000,
              stamp,
              randomUUID(),
            ]);
            pending.catch(() => {});
            const locked = await waitsForLock();
            await first.query("commit");
            assert.equal(locked, true);
            await assert.rejects(pending, /Reconciliation changed/);
            await assert.rejects(
              second.query(assignSql, [
                credit,
                allocationId,
                refundId,
                2000,
                await readStamp(),
                randomUUID(),
              ]),
              /remaining refund cash/,
            );
            const parentStamp = (
              await first.query("select refund_group_stamp($1) s", [tx])
            ).rows[0].s;
            await first.query("begin");
            await first.query(assignSql, [
              credit,
              allocationId,
              refundId,
              1000,
              await readStamp(),
              randomUUID(),
            ]);
            const parent = second.query(
              "select reverse_refund_group($1,$2,'Concurrent refund undo',$3)",
              [tx, parentStamp, randomUUID()],
            );
            parent.catch(() => {});
            const parentLocked = await waitsForLock();
            await first.query("commit");
            assert.equal(parentLocked, true);
            await assert.rejects(parent, /Refund group changed/);
            const currentGroup = (
              await first.query("select refund_group_stamp($1) s", [tx])
            ).rows[0].s;
            await assert.rejects(
              second.query(
                "select reverse_refund_group($1,$2,'Reviewed parent undo',$3)",
                [tx, currentGroup, randomUUID()],
              ),
              /Reverse invoice refund assignments/,
            );
            const net = (
              await admin.query(
                "select sum(amount*100*effect_sign)::bigint pence,count(*)::int n from financial_records where status='approved' and bank_transaction_id in ($1,$2)",
                [tx, returned],
              )
            ).rows[0];
            assert.equal(Number(net.pence), 6000);
            assert.equal(net.n, 2);
            const retained = (
              await admin.query(
                "select returned_pence,retained_cash_pence,outstanding_pence from invoice_payment_balances where id=$1",
                [invoice.id],
              )
            ).rows[0];
            assert.equal(Number(retained.returned_pence), 4000);
            assert.equal(Number(retained.retained_cash_pence), 1000);
            assert.equal(Number(retained.outstanding_pence), 2000);
          }
        }
      },
    );
    await serialSubtest(t,
      "reviewed identity serializes with ingestion and classification",
      async () => {
        const fingerprint = randomBytes(32).toString("hex");
        const identityRows = JSON.stringify([
          { ...JSON.parse(rows)[0], fingerprint },
        ]);
        async function identityImport() {
          const upload = await attempt(randomBytes(32).toString("hex"));
          const imported = (
            await admin.query(ingestSql, [owner, upload, identityRows])
          ).rows[0].result.import_id;
          return (
            await admin.query(
              "select id from bank_transactions where import_id=$1",
              [imported],
            )
          ).rows[0].id;
        }
        async function identityAuth(client: typeof first) {
          await client.query("reset role");
          await client.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          );
          await client.query("set role authenticated");
        }
        const canonical = await identityImport(),
          subject = await identityImport();
        await identityAuth(first);
        await identityAuth(second);
        const readStamp = async (id: string) =>
          (await first.query("select duplicate_group_stamp($1) s", [id]))
            .rows[0].s;
        const sql =
          "select approve_duplicate_decision($1,$2,$3,$4,'Checked concurrent evidence',$5)";
        const old = await readStamp(subject),
          newUpload = await attempt(randomBytes(32).toString("hex"));
        await first.query("reset role; set role service_role; begin");
        await first.query(ingestSql, [owner, newUpload, identityRows]);
        const stale = second.query(sql, [
          subject,
          null,
          "distinct",
          old,
          randomUUID(),
        ]);
        stale.catch(() => {});
        const ingestLocked = await waitsForLock();
        await first.query("commit");
        assert.equal(ingestLocked, true);
        await assert.rejects(stale, /Evidence changed/);
        await identityAuth(first);
        const reviewed = await readStamp(subject);
        await first.query("begin");
        await first.query(sql, [
          subject,
          null,
          "distinct",
          reviewed,
          randomUUID(),
        ]);
        const duplicateReview = second.query(sql, [
          subject,
          null,
          "distinct",
          reviewed,
          randomUUID(),
        ]);
        duplicateReview.catch(() => {});
        const decisionLocked = await waitsForLock();
        await first.query("commit");
        assert.equal(decisionLocked, true);
        await assert.rejects(duplicateReview, /Evidence changed/);
        const alias = await identityImport();
        const version = (
          await first.query(
            "select decision_version from bank_transactions where id=$1",
            [alias],
          )
        ).rows[0].decision_version;
        const category = (
          await admin.query(
            "select id from record_categories where is_default and record_type='income' limit 1",
          )
        ).rows[0].id;
        await first.query("begin");
        await first.query(sql, [
          alias,
          canonical,
          "duplicate",
          await readStamp(alias),
          randomUUID(),
        ]);
        const classification = second.query(
          "select review_bank_transaction($1,$2,'Business',$3,10000,'Stale include')",
          [alias, version, category],
        );
        classification.catch(() => {});
        const classifyLocked = await waitsForLock();
        await first.query("commit");
        assert.equal(classifyLocked, true);
        await assert.rejects(classification, /Decision changed/);
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from financial_records where bank_transaction_id=$1 and status='approved'",
              [alias],
            )
          ).rows[0].n,
          0,
        );
        // Inverse ordering: a review commits before ingestion. The new observation
        // remains unresolved rather than inheriting the earlier distinct verdict.
        const later = await attempt(randomBytes(32).toString("hex"));
        const unresolved = (
          await admin.query(
            "select id from bank_transactions where account_id=$1 and fingerprint=$2 and dedupe_status='needs_review' and active_duplicate_decision_id is null order by id limit 1",
            [account, fingerprint],
          )
        ).rows[0].id;
        await first.query("begin");
        await first.query(sql, [
          unresolved,
          null,
          "distinct",
          await readStamp(unresolved),
          randomUUID(),
        ]);
        await second.query("reset role; set role service_role");
        const ingest = second.query(ingestSql, [owner, later, identityRows]);
        ingest.catch(() => {});
        const reviewLocked = await waitsForLock();
        await first.query("commit");
        assert.equal(reviewLocked, true);
        const newImport = (await ingest).rows[0].result.import_id;
        assert.equal(
          (
            await admin.query(
              "select dedupe_status from bank_transactions where import_id=$1",
              [newImport],
            )
          ).rows[0].dedupe_status,
          "needs_review",
        );
      },
    );
    await serialSubtest(t,
      "evidence recovery commits one registration under concurrent retries",
      async () => {
        await first.query("reset role; set role service_role");
        await second.query("reset role; set role service_role");
        async function failedRecoveryAttempt() {
          const id = randomUUID(),
            path = `${owner}/${account}/${id}.enc`,
            hash = randomBytes(32).toString("hex");
          const plan = {
            version: 1,
            filename: "synthetic.csv",
            parser: "mapped-csv/1",
            mapping: {},
            row_count: 1,
            incoming_pence: 150000,
            outgoing_pence: 0,
            coverage_start: "2026-02-01",
            coverage_end: "2026-02-01",
          };
          await admin.query(
            "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state,recovery_plan) values ($1,$2,$3,$4,$5,'test',100,'failed',$6)",
            [id, owner, account, hash, path, JSON.stringify(plan)],
          );
          await admin.query(
            "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
            [path],
          );
          const stamp = (
            await first.query(
              "select stamp from evidence_recovery_attempts where id=$1 and kind='source'",
              [id],
            )
          ).rows[0].stamp;
          return { id, stamp };
        }
        const sql =
          "select complete_evidence_recovery($1,'source',$2,$3,$4,$5::jsonb,'Reviewed recovery race',$6) result";
        for (const sameRequest of [true, false]) {
          const a = await failedRecoveryAttempt(),
            request = randomUUID();
          const args = [owner, a.id, a.stamp, "e".repeat(64), rows, request];
          await first.query("begin");
          const result = (await first.query(sql, args)).rows[0].result;
          const pending = second.query(sql, [
            ...args.slice(0, 5),
            sameRequest ? request : randomUUID(),
          ]);
          pending.catch(() => {});
          const locked = await waitsForLock();
          await first.query("commit");
          assert.equal(locked, true);
          if (sameRequest)
            assert.deepEqual((await pending).rows[0].result, result);
          else await assert.rejects(pending, /scope changed/);
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from evidence_recovery_requests where source_attempt_id=$1",
                [a.id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from bank_transactions where import_id=$1",
                [result.import_id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await second.query(
                "update source_upload_attempts set state='uploaded' where id=$1 and state='pending' returning id",
                [a.id],
              )
            ).rows.length,
            0,
          );
          assert.equal(
            (
              await admin.query(
                "select state from source_upload_attempts where id=$1",
                [a.id],
              )
            ).rows[0].state,
            "linked",
          );
        }
      },
    );
    await serialSubtest(t,
      "merchant memory serializes reviewed categories, rule revisions and batch decisions",
      async () => {
        const merchantCategory = (
          await admin.query(
            "insert into record_categories(user_id,name,record_type) values ($1,'Merchant race category','expense') returning id",
            [owner],
          )
        ).rows[0].id;
        async function merchantAuth(client: typeof first) {
          await client.query("reset role");
          await client.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          );
          await client.query("set role authenticated");
        }
        async function merchantFixture() {
          await first.query("reset role");
          await first.query("set role service_role");
          const merchantRows = JSON.stringify([
            {
              row_number: 2,
              row_hash: randomBytes(32).toString("hex"),
              raw_encrypted: "synthetic",
              date: "2025-07-06",
              signed_pence: -63029,
              currency: "GBP",
              description: "Merchant race " + randomUUID(),
              reference: "synthetic",
              fingerprint: randomBytes(32).toString("hex"),
            },
          ]);
          const upload = await attempt(randomBytes(32).toString("hex"));
          const imp = (
            await first.query(ingestSql, [owner, upload, merchantRows])
          ).rows[0].result.import_id;
          const tx = (
            await admin.query(
              "select id from bank_transactions where import_id=$1",
              [imp],
            )
          ).rows[0].id;
          await merchantAuth(first);
          await merchantAuth(second);
          const definition = {
            seed_id: tx,
            status: "active",
            account_id: account,
            tax_year_start: 2025,
            effective_from: "2025-04-06",
            expires_on: "2026-04-05",
            priority: 50,
            classification: "Mixed",
            business_use_bps: 3000,
            category_id: merchantCategory,
            evidence_status: "provisional",
          };
          const initial = (
            await first.query(
              "select save_merchant_rule(null,0,$1,reconciliation_export_stamp(),'Reviewed merchant race',$2) r",
              [JSON.stringify(definition), randomUUID()],
            )
          ).rows[0].r;
          const stamp = (
            await first.query("select reconciliation_export_stamp() s")
          ).rows[0].s;
          const entry = [
            {
              transaction_id: tx,
              version: 0,
              origin: "rule",
              rule_version_id: initial.version_id,
              evidence_status: "provisional",
              document_ids: [],
            },
          ];
          return { tx, definition, initial, stamp, entry };
        }
        const approve =
          "select approve_merchant_batch($1,$2,'Reviewed race batch',$3) r";
        const fixture = await merchantFixture();
        await first.query("begin");
        await first.query(
          "update record_categories set name='Renamed before confirmation' where id=$1",
          [merchantCategory],
        );
        const pending = second.query(approve, [
          JSON.stringify(fixture.entry),
          fixture.stamp,
          randomUUID(),
        ]);
        pending.catch(() => {});
        const categoryWait = await waitsForLock();
        await first.query("commit");
        assert.equal(categoryWait, true);
        await assert.rejects(pending, /state changed/);
        assert.equal(
          (
            await admin.query(
              "select classification from bank_transactions where id=$1",
              [fixture.tx],
            )
          ).rows[0].classification,
          "Unknown",
        );
        for (const batchFirst of [false, true]) {
          const f = await merchantFixture();
          await first.query("begin");
          const change =
            "select save_merchant_rule($1,1,$2,$3,'Reviewed revised rule',$4) r";
          let next: Promise<unknown>;
          if (batchFirst) {
            await first.query(approve, [
              JSON.stringify(f.entry),
              f.stamp,
              randomUUID(),
            ]);
            next = second.query(change, [
              f.initial.rule_id,
              JSON.stringify({ ...f.definition, priority: 80 }),
              f.stamp,
              randomUUID(),
            ]);
          } else {
            await first.query(change, [
              f.initial.rule_id,
              JSON.stringify({ ...f.definition, priority: 80 }),
              f.stamp,
              randomUUID(),
            ]);
            next = second.query(approve, [
              JSON.stringify(f.entry),
              f.stamp,
              randomUUID(),
            ]);
          }
          next.catch(() => {});
          const waiting = await waitsForLock();
          await first.query("commit");
          assert.equal(waiting, true);
          await assert.rejects(next, /state changed/);
          assert.equal(
            (
              await admin.query(
                "select classification from bank_transactions where id=$1",
                [f.tx],
              )
            ).rows[0].classification,
            batchFirst ? "Mixed" : "Unknown",
          );
        }
        const f = await merchantFixture();
        await first.query("begin");
        await first.query(
          "select review_bank_transaction($1,0,'Personal',null,0,'New personal evidence')",
          [f.tx],
        );
        const stale = second.query(approve, [
          JSON.stringify(f.entry),
          f.stamp,
          randomUUID(),
        ]);
        stale.catch(() => {});
        const waiting = await waitsForLock();
        await first.query("commit");
        assert.equal(waiting, true);
        await assert.rejects(stale, /state changed/);
        assert.equal(
          (
            await admin.query(
              "select classification from bank_transactions where id=$1",
              [f.tx],
            )
          ).rows[0].classification,
          "Personal",
        );
      },
    );
    await serialSubtest(t,
      "tax reviews serialize revisions and expose changed financial completeness in both commit orders",
      async () => {
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
        async function taxAuth(client: typeof first) {
          await client.query("reset role");
          await client.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          );
          await client.query("set role authenticated");
        }
        await taxAuth(first);
        await taxAuth(second);
        const sql =
            "select review_tax_inputs($1,$2,$3,'Reviewed synthetic tax race',$4) r",
          review = JSON.stringify({
            action: "profile",
            expected_ordinal: 0,
            state: "reviewed",
            data,
          });
        const stamp = (await first.query("select tax_review_stamp(2028) s"))
          .rows[0].s;
        await first.query("begin");
        const saved = (
          await first.query(sql, [2028, review, stamp, randomUUID()])
        ).rows[0].r;
        const pending = second.query(sql, [2028, review, stamp, randomUUID()]);
        pending.catch(() => {});
        const locked = await waitsForLock();
        await first.query("commit");
        assert.equal(locked, true);
        await assert.rejects(pending, /inputs changed/);
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from tax_profile_revisions where profile_id=$1",
              [saved.profile_id],
            )
          ).rows[0].n,
          1,
        );
        for (const profileFirst of [false, true]) {
          const year = profileFirst ? 2030 : 2029;
          await first.query("reset role");
          await first.query("set role service_role");
          const upload = await attempt(randomBytes(32).toString("hex"));
          const contents = JSON.stringify([
            {
              row_number: 2,
              row_hash: randomBytes(32).toString("hex"),
              raw_encrypted: "synthetic",
              date: "2026-02-01",
              signed_pence: 10000,
              currency: "GBP",
              description: "Tax review race",
              reference: "synthetic",
              fingerprint: randomBytes(32).toString("hex"),
            },
          ]);
          const imported = (
              await first.query(ingestSql, [owner, upload, contents])
            ).rows[0].result.import_id,
            tx = (
              await admin.query(
                "select id from bank_transactions where import_id=$1",
                [imported],
              )
            ).rows[0].id;
          await taxAuth(first);
          await taxAuth(second);
          const s = (await first.query("select tax_review_stamp($1) s", [year]))
            .rows[0].s;
          await first.query("begin");
          let next: Promise<unknown>;
          if (profileFirst) {
            await first.query(sql, [year, review, s, randomUUID()]);
            next = second.query(
              "select review_bank_transaction($1,0,'Personal',null,0,'Reviewed classification after tax profile')",
              [tx],
            );
          } else {
            await first.query(
              "select review_bank_transaction($1,0,'Personal',null,0,'Reviewed classification before tax profile')",
              [tx],
            );
            next = second.query(sql, [year, review, s, randomUUID()]);
          }
          next.catch(() => {});
          const waiting = await waitsForLock();
          await first.query("commit");
          assert.equal(waiting, true);
          if (profileFirst) {
            await next;
            assert.equal(
              (
                await first.query(
                  "select ledger_is_current from current_tax_profiles where tax_year_start=$1",
                  [year],
                )
              ).rows[0].ledger_is_current,
              false,
            );
          } else await assert.rejects(next, /inputs changed/);
        }
      },
    );
    await serialSubtest(t,'calculation capture excludes concurrent direct edits, phantom inserts and category changes in both orders',async()=>{
      async function taxAuth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      async function prepared(){await taxAuth(first);const input=(await first.query('select read_tax_calculation_input(2025) v')).rows[0].v as CalculationInput;assert.equal(input.financial_stamp,(await first.query('select reconciliation_export_stamp() s')).rows[0].s);return prepareCalculation(input);}
      async function service(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub','',false)");await client.query('set role service_role');}
      const category=(await admin.query("insert into record_categories(user_id,name,record_type,is_default) values ($1,'Synthetic snapshot category','expense',false) returning id",[owner])).rows[0].id;
      const record=(await admin.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',10.01,'Synthetic snapshot race','manual','approved',$2) returning id",[owner,category])).rows[0].id;
      const sql='select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) id';
      for(const mutation of ['record','insert','category','year']){
        const snapshot=await prepared(),args=[owner,snapshot.inputJson,snapshot.resultJson,snapshot.rulesJson,'Reviewed synthetic capture race',randomUUID()];
        await service(first);await service(second);await first.query('begin');await first.query(sql,args);
        const changeFor=()=>mutation==='record'?['update financial_records set amount=amount+0.01 where id=$1',[record]] as const:mutation==='insert'?["insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status) values ($1,'income','2025-08-02',1,'Synthetic phantom','manual','approved')",[owner]] as const:mutation==='category'?['update record_categories set sa103_box=$1 where id=$2',['synthetic-'+randomUUID(),category]] as const:['update financial_records set record_date=$1 where id=$2',['2026-08-01',record]] as const;
        const change=changeFor();
        const pending=second.query(change[0],[...change[1]]);pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await pending;
        // The original byte snapshot remains recoverable even after that committed change.
        assert.equal((await first.query(sql,args)).rows.length,1);
        await assert.rejects(first.query(sql,[...args.slice(0,5),randomUUID()]),/inputs changed/);
        // Reverse order: the live writer makes capture fail immediately, then reject the old input after commit.
        if(mutation==='year')await admin.query("update financial_records set record_date='2025-08-01' where id=$1",[record]);
        const before=await prepared();await service(first);await service(second);await second.query('begin');const writer=changeFor();await second.query(writer[0],[...writer[1]]);
        const captureArgs=[owner,before.inputJson,before.resultJson,before.rulesJson,'Reviewed synthetic capture race',randomUUID()];
        await assert.rejects(first.query(sql,captureArgs),/could not obtain lock/);await second.query('commit');await assert.rejects(first.query(sql,captureArgs),/inputs changed/);
      }
    });
    await serialSubtest(t,'draft pack capture serializes independent evidence writes and changed step answers in both orders',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      async function service(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub','',false)");await client.query('set role service_role');}
      async function input(){await auth(first);const p=prepareCalculation((await first.query('select read_tax_calculation_input(2025) v')).rows[0].v as CalculationInput);await service(first);const c=(await first.query('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) id',[owner,p.inputJson,p.resultJson,p.rulesJson,'Synthetic pack race',randomUUID()])).rows[0].id;await auth(first);return {c,value:(await first.query('select read_tax_filing_pack_input($1) v',[c])).rows[0].v as FilingPackInput};}
      const sql='select capture_filing_pack($1,$2,$3,$4,$5,$6) id',reviewSql='select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) id';
      // Each table can acquire its writer lock independently of financial review locks.
      const doc=(await admin.query("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',10,$3,'synthetic') returning id",[owner,randomBytes(32).toString('hex'),'synthetic/'+randomUUID()])).rows[0].id;
      const batch=(await admin.query("insert into document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) values ($1,$2,2025,'other','synthetic/1') returning id",[owner,doc])).rows[0].id;
      function evidence(kind:string){if(kind==='document')return ["with d as (insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',10,$3,'synthetic') returning id) insert into document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) select $1,id,2025,'other','synthetic/1' from d",[owner,randomBytes(32).toString('hex'),'synthetic/'+randomUUID()]] as const;
        if(kind==='batch')return ["insert into document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) values ($1,$2,2025,'other','synthetic/1')",[owner,batchRoots.pop()!]] as const;
        return ["insert into document_batch_items(user_id,batch_id,document_id,ordinal,original_name_encrypted) values ($1,$2,$3,$4,'synthetic')",[owner,batch,doc,++itemOrdinal]] as const;}
      const batchRoots:string[]=[];for(let i=0;i<2;i++)batchRoots.push((await admin.query("insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',10,$3,'synthetic') returning id",[owner,randomBytes(32).toString('hex'),'synthetic/'+randomUUID()])).rows[0].id);
      let itemOrdinal=0;
      for(const kind of ['document','batch','item']){
        const snapshot=await input(),request=randomUUID(),bundle=buildFilingPack(snapshot.value,[],request,false),args=[owner,snapshot.c,canonicalJson(snapshot.value),canonicalJson(bundle),'Reviewed synthetic pack race',request];
        await service(first);await service(second);await first.query('begin');const saved=(await first.query(sql,args)).rows[0].id;
        const writer=evidence(kind),pending=second.query(writer[0],[...writer[1]]);pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await pending;
        assert.equal((await first.query(sql,args)).rows[0].id,saved);
        const next=randomUUID(),nextBundle=buildFilingPack(snapshot.value,[],next,false);await assert.rejects(first.query(sql,[owner,snapshot.c,args[2],canonicalJson(nextBundle),args[4],next]),/inputs changed/);
        const before=await input(),fresh=randomUUID(),old=buildFilingPack(before.value,[],fresh,false),staleArgs=[owner,before.c,canonicalJson(before.value),canonicalJson(old),'Reviewed synthetic pack race',fresh];
        await service(first);await service(second);await second.query('begin');const change=evidence(kind);await second.query(change[0],[...change[1]]);
        await assert.rejects(first.query(sql,staleArgs),/could not obtain lock/);await second.query('commit');await assert.rejects(first.query(sql,staleArgs),/inputs changed/);
        assert.equal((await admin.query('select count(*)::int n from filing_packs where user_id=$1 and request_id=$2',[owner,fresh])).rows[0].n,0);
      }
      for(const reviewFirst of [true,false]){
        const snapshot=await input(),text=canonicalJson(snapshot.value),model=buildFilingReview(snapshot.value,[]),digest=model.steps.find(s=>s.id==='profile')!.digest,oldData={trade_form:'short',short_eligibility:'full_year_simple'};
        await service(first);const id=(await first.query(reviewSql,[owner,snapshot.c,text,'profile',digest,oldData,'Synthetic initial answer',randomUUID()])).rows[0].id;
        const old=(await admin.query('select id,step,digest,data,reason,author,created_at::text from filing_pack_step_reviews where id=$1',[id])).rows[0] as StepReview,request=randomUUID(),bundle=buildFilingPack(snapshot.value,[old],request,false),args=[owner,snapshot.c,text,canonicalJson(bundle),'Synthetic capture with current answer',request],changed=[owner,snapshot.c,text,'profile',digest,{trade_form:'full',short_eligibility:'requires_full'},'Synthetic changed answer',randomUUID()];
        await service(first);await service(second);await first.query('begin');let saved:string|undefined;
        if(reviewFirst)await first.query(reviewSql,changed);else saved=(await first.query(sql,args)).rows[0].id;
        const pending=reviewFirst?second.query(sql,args):second.query(reviewSql,changed);pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);
        if(reviewFirst)await assert.rejects(pending,/provenance changed/);else{await pending;assert.equal((await first.query(sql,args)).rows[0].id,saved);const next=randomUUID(),stale=buildFilingPack(snapshot.value,[old],next,false);await assert.rejects(first.query(sql,[owner,snapshot.c,text,canonicalJson(stale),args[4],next]),/provenance changed/);}
      }
      // The new provenance dependencies also admit privileged writes that do
      // not acquire the owner's advisory lock. Prove real relation-lock conflict
      // in both orders, rather than inferring safety from the function source.
      for(const table of ['public.fx_conversion_lots','public.invoice_settlements','public.invoice_revisions','public.fx_document_fact_families','public.fx_document_fact_revisions','storage.objects']){
        const snapshot=await input(),request=randomUUID(),bundle=buildFilingPack(snapshot.value,[],request,false),args=[owner,snapshot.c,canonicalJson(snapshot.value),canonicalJson(bundle),'Synthetic FX dependency lock',request];
        await service(first);await second.query('reset role');await first.query('begin');await first.query(sql,args);await second.query('begin');
        const writer=second.query(`lock table ${table} in row exclusive mode`);writer.catch(()=>{});
        const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true,table);await writer;await second.query('rollback');
        assert.equal((await first.query(sql,args)).rows.length,1);
        const next=randomUUID(),fresh=buildFilingPack(snapshot.value,[],next,false),newArgs=[owner,snapshot.c,args[2],canonicalJson(fresh),args[4],next];
        await second.query('begin');await second.query(`lock table ${table} in row exclusive mode`);
        await assert.rejects(first.query(sql,newArgs),/could not obtain lock/);await second.query('rollback');
        assert.equal((await first.query(sql,newArgs)).rows.length,1);
      }
    });
    await serialSubtest(t,'annual merchant rollovers serialize retries, source revisions and category meaning in both orders',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      async function stamp(){return (await first.query('select reconciliation_export_stamp() s')).rows[0].s;}
      const save='select save_merchant_rule($1,$2,$3,$4,$5,$6) r',roll='select rollover_merchant_rule($1,2026,$2,$3,$4,$5) r';
      async function fixture(){
        await first.query('reset role');await first.query('set role service_role');
        const category=(await admin.query("insert into record_categories(user_id,name,record_type) values ($1,$2,'expense') returning id",[owner,'Rollover category '+randomUUID()])).rows[0].id;
        const attemptId=await attempt(randomBytes(32).toString('hex')),description='Synthetic rollover '+randomUUID(),data=JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2025-07-01',signed_pence:-1000,currency:'GBP',description,reference:'Synthetic',fingerprint:randomBytes(32).toString('hex')}]);
        const imp=(await first.query(ingestSql,[owner,attemptId,data])).rows[0].result.import_id,seed=(await admin.query('select id from bank_transactions where import_id=$1',[imp])).rows[0].id;
        await auth(first);const old={seed_id:seed,status:'active',account_id:null,tax_year_start:2025,effective_from:'2025-04-06',expires_on:'2026-04-05',priority:50,classification:'Business',business_use_bps:10000,category_id:category,evidence_status:'provisional'};
        const source=(await first.query(save,[null,0,old,await stamp(),'Synthetic prior-year rule',randomUUID()])).rows[0].r;
        const next={...old,status:'disabled',tax_year_start:2026,effective_from:'2026-04-06',expires_on:'2027-04-05'};return {category,old,next,source,stamp:await stamp()};
      }
      for(const sameRequest of [true,false]){
        const f=await fixture(),request=randomUUID(),args=[f.source.version_id,f.next,f.stamp,'Synthetic annual review',request];await auth(first);await auth(second);await first.query('begin');const result=(await first.query(roll,args)).rows[0].r;
        const pending=second.query(roll,[...args.slice(0,4),sameRequest?request:randomUUID()]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,result);else await assert.rejects(pending,/review changed/);
        assert.equal((await admin.query('select count(*)::int n from merchant_rule_rollovers where user_id=$1 and source_rule_id=$2',[owner,f.source.rule_id])).rows[0].n,1);
      }
      for(const sourceFirst of [true,false]){
        const f=await fixture(),args=[f.source.version_id,f.next,f.stamp,'Synthetic annual review',randomUUID()],change=[f.source.rule_id,1,{...f.old,status:'disabled'},f.stamp,'Synthetic source revision',randomUUID()];
        await auth(first);await auth(second);await first.query('begin');if(sourceFirst)await first.query(save,change);else await first.query(roll,args);
        const pending=sourceFirst?second.query(roll,args):second.query(save,change);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/review changed|Review state changed/);
        assert.equal((await admin.query('select count(*)::int n from merchant_rule_rollovers where source_rule_id=$1',[f.source.rule_id])).rows[0].n,sourceFirst?0:1);
      }
      for(const categoryFirst of [true,false]){
        const f=await fixture(),args=[f.source.version_id,f.next,f.stamp,'Synthetic annual review',randomUUID()];await auth(first);await auth(second);await first.query('begin');
        if(categoryFirst)await first.query("update record_categories set name=name||' revised' where id=$1",[f.category]);else await first.query(roll,args);
        const pending=categoryFirst?second.query(roll,args):second.query("update record_categories set name=name||' revised' where id=$1",[f.category]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(categoryFirst)await assert.rejects(pending,/review changed/);else{await pending;assert.equal((await first.query(roll,args)).rows.length,1);}
      }
    });
    await serialSubtest(t,'owner-wide cash capture serializes competing revisions and direct source inserts in both orders',async()=>{
      async function service(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub','',false)");await client.query('set role service_role');}
      async function context(){await first.query('reset role');await first.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await first.query('set role authenticated');return (await first.query('select read_finance_plan_context() c')).rows[0].c;}
      const sql='select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) id',today=londonPlanningDate(),plan=financeFixture(today);
      const beforeRecords=(await admin.query('select count(*)::int n from financial_records')).rows[0].n;
      function args(ctx:PlanContext,request=randomUUID()){const p=prepareBankCoveredFinancePlan(owner,plan,today,{accounts:[],documents:[]},ctx.invoice_coverage,ctx.bank_source_coverage);return [owner,ctx.ordinal,ctx.stamp,p.inputJson,p.resultJson,p.rulesJson,'Synthetic concurrent cash review',request];}
      const initial=await context(),a=args(initial),b=args(initial);await service(first);await service(second);await first.query('begin');const id=(await first.query(sql,a)).rows[0].id;
      const competing=second.query(sql,b);competing.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await assert.rejects(competing,/changed/);
      assert.equal((await first.query(sql,a)).rows[0].id,id);
      const cashClient=(await admin.query("insert into clients(user_id,name) values($1,'Synthetic cash coverage race') returning id",[owner])).rows[0].id;
      function writer(kind:string){if(kind==='invoice')return ["insert into invoices(user_id,client_id,number,description,amount) values($1,$2,$3,'Synthetic draft phantom',0)",[owner,cashClient,'CASH-RACE-'+randomUUID()]] as const;return kind==='account'?["insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic cash phantom','generic','bank','1234')",[owner]] as const:["insert into evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,'application/pdf',10,$3,'synthetic')",[owner,randomBytes(32).toString('hex'),'synthetic/'+randomUUID()]] as const;}
      for(const kind of ['account','document','invoice']){
        const ctx=await context(),capture=args(ctx);await service(first);await service(second);await first.query('begin');const saved=(await first.query(sql,capture)).rows[0].id;
        const change=writer(kind),pending=second.query(change[0],[...change[1]]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await pending;
        assert.equal((await first.query(sql,capture)).rows[0].id,saved);await assert.rejects(first.query(sql,args(ctx)),/sources changed/);
        const fresh=await context(),stale=args(fresh);await service(first);await service(second);await second.query('begin');const mutation=writer(kind);await second.query(mutation[0],[...mutation[1]]);
        await assert.rejects(first.query(sql,stale),/could not obtain lock/);await second.query('commit');await assert.rejects(first.query(sql,stale),/sources changed/);
        assert.equal((await admin.query('select count(*)::int n from finance_plan_revisions where request_id=$1',[stale[7]])).rows[0].n,0);
      }
      assert.equal((await admin.query('select count(*)::int n from financial_records')).rows[0].n,beforeRecords);
    });
    await serialSubtest(t,'deadline review capture serializes retries and cash-plan transitions in both commit orders',async()=>{
      const cashSql='select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) id',deadlineSql='select capture_tax_deadline_review($1,$2,$3,$4,$5,$6,$7,$8,$9) id',today=londonPlanningDate();
      async function service(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub','',false)");await client.query('set role service_role');}
      async function fixture(hasPlan:boolean){
        const who=randomUUID();await admin.query('insert into auth.users values($1)',[who]);
        const plan=emptyFinancePlan(today);plan.obligations.push({id:'synthetic-demand',label:'Synthetic reviewed unpaid amount',kind:'tax',tax_year_start:2025,due_date:'2027-01-31',amount_pence:10000});
        async function cashArgs(){const ctx=(await admin.query('select finance_plan_context_for_owner($1) c',[who])).rows[0].c;const prepared=prepareBankCoveredFinancePlan(who,plan,today,{accounts:[],documents:[]},ctx.invoice_coverage,ctx.bank_source_coverage);return [who,ctx.ordinal,ctx.stamp,prepared.inputJson,prepared.resultJson,prepared.rulesJson,'Synthetic concurrent source review',randomUUID()];}
        if(hasPlan){await service(first);await first.query(cashSql,await cashArgs());}
        const source=(await admin.query('select * from finance_plan_revisions where user_id=$1 order by ordinal desc limit 1',[who])).rows[0]??null,catalog=deadlineCatalogFromPlan(who,2025,source,[]),p=prepareDeadlineSnapshot(who,emptyDeadlinePlan(2025,catalog),today,catalog);
        const ctx=(await admin.query('select tax_deadline_context_for_owner($1,2025) c',[who])).rows[0].c;
        return {who,cashArgs,args:[who,2025,ctx.ordinal,ctx.stamp,p.inputJson,p.resultJson,p.rulesJson,'Synthetic concurrent reminder review',randomUUID()]};
      }
      const records=(await admin.query('select count(*)::int n from financial_records')).rows[0].n;
      for(const sameRequest of [true,false]){
        const f=await fixture(true);await service(first);await service(second);await first.query('begin');const saved=(await first.query(deadlineSql,f.args)).rows[0].id;
        const other=[...f.args];if(!sameRequest)other[8]=randomUUID();const pending=second.query(deadlineSql,other);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.equal((await pending).rows[0].id,saved);else await assert.rejects(pending,/review or sources changed/);
        assert.equal((await admin.query('select count(*)::int n from tax_deadline_revisions where user_id=$1',[f.who])).rows[0].n,1);
      }
      for(const hasPlan of [false,true])for(const cashFirst of [false,true]){
        const f=await fixture(hasPlan),cash=await f.cashArgs();await service(first);await service(second);await first.query('begin');let saved:string|undefined;
        if(cashFirst)await first.query(cashSql,cash);else saved=(await first.query(deadlineSql,f.args)).rows[0].id;
        const pending=cashFirst?second.query(deadlineSql,f.args):second.query(cashSql,cash);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(cashFirst)await assert.rejects(pending,/review or sources changed/);else{
          await pending;assert.equal((await first.query(deadlineSql,f.args)).rows[0].id,saved);const fresh=[...f.args];fresh[8]=randomUUID();await assert.rejects(first.query(deadlineSql,fresh),/review or sources changed/);
        }
        assert.equal((await admin.query('select count(*)::int n from tax_deadline_revisions where user_id=$1',[f.who])).rows[0].n,cashFirst?0:1);
      }
      assert.equal((await admin.query('select count(*)::int n from financial_records')).rows[0].n,records);
    });
    await serialSubtest(t,'complete refund reversal serializes exact retries and competing approvals in both commit orders',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      const category=(await admin.query("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
      const reverseSql="select reverse_refund_closure('original',$1,$2,'Synthetic native complete reversal',$3) r";
      async function fixture(){
        await first.query('reset role');await first.query('set role service_role');const upload=await attempt(randomBytes(32).toString('hex'));
        const rows=[-10000,4000,6000].map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:amount,currency:'GBP',description:'Synthetic closure race',reference:'',fingerprint:randomBytes(32).toString('hex')}));
        const imp=(await first.query(ingestSql,[owner,upload,JSON.stringify(rows)])).rows[0].result.import_id;
        const tx=(await admin.query('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number',[imp])).rows.map((r:{id:string})=>r.id);
        await auth(first);await auth(second);await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic source review')",[tx[0],category]);
        const before=(await first.query('select refund_group_stamp($1) s',[tx[0]])).rows[0].s;
        await first.query("select approve_refund($1,1,$2,0,$3,'Synthetic first refund',$4)",[tx[0],tx[1],before,randomUUID()]);
        const stamp=(await first.query('select reconciliation_export_stamp() s')).rows[0].s,group=(await first.query('select refund_group_stamp($1) s',[tx[0]])).rows[0].s;
        return {tx,stamp,group,args:[tx[0],stamp,randomUUID()]};
      }
      for(const sameRequest of [true,false]){
        const f=await fixture();await first.query('begin');const saved=(await first.query(reverseSql,f.args)).rows[0].r;
        const args=[...f.args];if(!sameRequest)args[2]=randomUUID();const pending=second.query(reverseSql,args);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select decision_version from bank_transactions where id=$1',[f.tx[1]])).rows[0].decision_version,2);
      }
      const approveSql="select approve_refund($1,1,$2,0,$3,'Synthetic competing refund',$4)";
      for(const reversalFirst of [true,false]){
        const f=await fixture(),approval=[f.tx[0],f.tx[2],f.group,randomUUID()];await first.query('begin');
        if(reversalFirst)await first.query(reverseSql,f.args);else await first.query(approveSql,approval);
        const pending=reversalFirst?second.query(approveSql,approval):second.query(reverseSql,f.args);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        await assert.rejects(pending,reversalFirst?/decisions changed/:/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_refunds where user_id=$1 and original_transaction_id=$2',[owner,f.tx[0]])).rows[0].n,reversalFirst?0:2);
      }
    });
    await serialSubtest(t,'shared refund writer serializes retries, legacy competitors and category meaning in both orders',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      const splitSql='select approve_refund_split($1) r';
      async function fixture(){
        await first.query('reset role');await first.query('set role service_role');const upload=await attempt(randomBytes(32).toString('hex'));
        const rows=[-10000,-10000,10000,5000].map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:amount,currency:'GBP',description:'Synthetic split race',reference:'',fingerprint:randomBytes(32).toString('hex')}));
        const imp=(await first.query(ingestSql,[owner,upload,JSON.stringify(rows)])).rows[0].result.import_id;
        const tx=(await admin.query('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number',[imp])).rows.map((r:{id:string})=>r.id);
        const category=(await admin.query("insert into record_categories(user_id,name,record_type) values($1,$2,'expense') returning id",[owner,'Synthetic category '+randomUUID()])).rows[0].id;
        await auth(first);await auth(second);for(const id of tx.slice(0,2))await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic split original')",[id,category]);
        const allocations=[];for(const id of tx.slice(0,2))allocations.push({original_id:id,original_version:1,refund_stamp:(await first.query('select refund_group_stamp($1) s',[id])).rows[0].s,amount_pence:5000});
        const intent={schema_version:'refund-split-intent/1',refund_id:tx[2],refund_version:0,expected_stamp:(await first.query('select reconciliation_export_stamp() s')).rows[0].s,allocations,rationale:'Synthetic concurrent split review',request_id:randomUUID()};
        return {tx,category,intent};
      }
      for(const sameRequest of [true,false]){
        const f=await fixture();await first.query('begin');const saved=(await first.query(splitSql,[JSON.stringify(f.intent)])).rows[0].r;
        const competing={...f.intent,request_id:sameRequest?f.intent.request_id:randomUUID(),allocations:[...f.intent.allocations].reverse()};
        const pending=second.query(splitSql,[JSON.stringify(competing)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=$1',[f.tx[2]])).rows[0].n,2);
      }
      for(const splitFirst of [true,false]){
        const f=await fixture(),legacy="select approve_refund($1,1,$2,0,$3,'Synthetic legacy competitor',$4)",args=[f.tx[0],f.tx[3],f.intent.allocations[0].refund_stamp,randomUUID()];await first.query('begin');
        if(splitFirst)await first.query(splitSql,[JSON.stringify(f.intent)]);else await first.query(legacy,args);
        const pending=splitFirst?second.query(legacy,args):second.query(splitSql,[JSON.stringify(f.intent)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,splitFirst?/decisions changed/:/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=$1',[f.tx[2]])).rows[0].n,splitFirst?2:0);
      }
      for(const splitFirst of [true,false]){
        const f=await fixture(),rename="update record_categories set name='Changed synthetic meaning '||id::text where id=$1";await first.query('begin');
        if(splitFirst)await first.query(splitSql,[JSON.stringify(f.intent)]);else await first.query(rename,[f.category]);
        const pending=splitFirst?second.query(rename,[f.category]):second.query(splitSql,[JSON.stringify(f.intent)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(splitFirst)await pending;else await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=$1',[f.tx[2]])).rows[0].n,splitFirst?2:0);
      }
    });
    await serialSubtest(t,'complete import reversal serializes retries and new shared refunds in both commit orders',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      const category=(await admin.query("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
      const reverseSql="select reverse_source_import_reviewed($1,$2,'Synthetic native full import reversal',$3) r",splitSql='select approve_refund_split($1) r';
      async function fixture(){
        await first.query('reset role');await first.query('set role service_role');const upload=await attempt(randomBytes(32).toString('hex'));
        const rows=[-10000,-10000,10000,5000].map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:amount,currency:'GBP',description:'Synthetic full import race',reference:'',fingerprint:randomBytes(32).toString('hex')}));
        const imp=(await first.query(ingestSql,[owner,upload,JSON.stringify(rows)])).rows[0].result.import_id;
        const tx=(await admin.query('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number',[imp])).rows.map((r:{id:string})=>r.id);
        await auth(first);await auth(second);for(const id of tx.slice(0,2))await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic imported original')",[id,category]);
        async function intent(refund:string,amount:number){const allocations=[];for(const id of tx.slice(0,2))allocations.push({original_id:id,original_version:1,refund_stamp:(await first.query('select refund_group_stamp($1) s',[id])).rows[0].s,amount_pence:amount});return {schema_version:'refund-split-intent/1',refund_id:refund,refund_version:0,expected_stamp:(await first.query('select reconciliation_export_stamp() s')).rows[0].s,allocations,rationale:'Synthetic native refund allocation',request_id:randomUUID()};}
        await first.query(splitSql,[JSON.stringify(await intent(tx[2],5000))]);
        const next=await intent(tx[3],2500),stamp=(await first.query('select reconciliation_export_stamp() s')).rows[0].s;
        return {imp,tx,next,args:[imp,stamp,randomUUID()]};
      }
      for(const same of [true,false]){
        const f=await fixture();await first.query('begin');const result=(await first.query(reverseSql,f.args)).rows[0].r;
        const args=[...f.args];if(!same)args[2]=randomUUID();const pending=second.query(reverseSql,args);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(same)assert.deepEqual((await pending).rows[0].r,result);else await assert.rejects(pending,/context changed/);
        const versions=(await admin.query('select decision_version,classification from bank_transactions where id=any($1::uuid[]) order by id',[f.tx])).rows;assert.ok(versions.every((r:{classification:string})=>r.classification==='Unknown'));
        assert.equal((await admin.query('select decision_version from bank_transactions where id=$1',[f.tx[2]])).rows[0].decision_version,2);
      }
      for(const reversalFirst of [true,false]){
        const f=await fixture();await first.query('begin');if(reversalFirst)await first.query(reverseSql,f.args);else await first.query(splitSql,[JSON.stringify(f.next)]);
        const pending=reversalFirst?second.query(splitSql,[JSON.stringify(f.next)]):second.query(reverseSql,f.args);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select status from record_imports where id=$1',[f.imp])).rows[0].status,reversalFirst?'discarded':'review');
        assert.equal((await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=any($1::uuid[])',[f.tx.slice(2)])).rows[0].n,reversalFirst?0:4);
      }
    });
    await serialSubtest(t,'shared customer refunds serialize assignment, connected/import reversal and invoice lock waits',async()=>{
      async function auth(connection:typeof first){
        await connection.query('reset role');
        await connection.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
        await connection.query('set role authenticated');
      }
      for(const role of ['anon','service_role','authenticated'])assert.equal((await admin.query("select has_function_privilege($1,'public.reverse_invoice_refund_assignment(uuid,text,text,uuid)','execute') allowed",[role])).rows[0].allowed,role==='authenticated');
      const stamp=async()=>(await first.query('select reconciliation_export_stamp() s')).rows[0].s;
      const assignSql="select approve_invoice_refund_assignment($1,$2,$3,5000,$4,'Synthetic shared customer return',$5) r";
      const undoSql="select reverse_invoice_refund_assignment($1,$2,'Synthetic reviewed assignment undo',$3) r";
      async function fixture(){
        const imports:string[]=[],tx:string[]=[];
        for(const amounts of [[10000,10000],[-10000]]){
          const upload=await attempt(randomBytes(32).toString('hex'));
          const rows=amounts.map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:amount,currency:'GBP',description:'Synthetic shared customer return',reference:'',fingerprint:randomBytes(32).toString('hex')}));
          const imp=(await admin.query(ingestSql,[owner,upload,JSON.stringify(rows)])).rows[0].result.import_id;
          imports.push(imp);
          tx.push(...(await admin.query('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number',[imp])).rows.map((r:{id:string})=>r.id));
        }
        await auth(first);await auth(second);
        const category=(await admin.query("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
        for(const id of tx.slice(0,2))await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic original receipt')",[id,category]);
        const allocations=[];
        for(const id of tx.slice(0,2))allocations.push({original_id:id,original_version:1,refund_stamp:(await first.query('select refund_group_stamp($1) s',[id])).rows[0].s,amount_pence:5000});
        const intent={schema_version:'refund-split-intent/1',refund_id:tx[2],refund_version:0,expected_stamp:await stamp(),allocations,rationale:'Synthetic shared customer cash',request_id:randomUUID()};
        await first.query('select approve_refund_split($1)',[JSON.stringify(intent)]);
        const client=(await admin.query('insert into clients(user_id,name) values($1,$2) returning id',[owner,'Synthetic shared return '+randomUUID()])).rows[0].id;
        const invoices:string[]=[],credits:string[]=[],settlements:string[]=[],links:string[]=[];
        for(const original of tx.slice(0,2)){
          const invoice=randomUUID(),revision=randomUUID(),number='SHARED-'+invoice,path=`${owner}/revisions/${revision}.pdf`;
          await admin.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[path]);
          await first.query('select save_invoice_revision($1,$2,null,$3,$4,$5)',[invoice,revision,JSON.stringify({client_id:client,number,invoice_date:'2026-04-10',due_date:'2026-05-10',description:'Synthetic shared supply',payment_terms:'30 days',net_pence:10000,vat_pence:0,vat_rate_bps:0,vat_enabled:false,vat_number:'',reason:'Synthetic reviewed invoice'}),path,'a'.repeat(64)]);
          const version=(await first.query('select updated_at::text v from invoices where id=$1',[invoice])).rows[0].v;
          await first.query("select approve_invoice_allocations($1,1,$2,'Synthetic reviewed match',$3,0)",[original,JSON.stringify([{invoice_id:invoice,invoice_updated_at:version,amount_pence:10000}]),randomUUID()]);
          const credit=randomUUID(),creditPath=`${owner}/credits/${credit}.pdf`,b=(await first.query('select balance_stamp,next_ordinal from invoice_credit_choices where id=$1',[invoice])).rows[0];
          await admin.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[creditPath]);
          const document={number:`CN-${number}-${String(b.next_ordinal).padStart(3,'0')}`,creditDate:'2026-04-11',invoiceNumber:number,invoiceDate:'2026-04-10',description:'Synthetic shared supply',sellerName:'Synthetic supplier',sellerAddress:'',clientName:'Synthetic shared customer',clientAddress:'',reason:'Synthetic reviewed credit',grossPence:5000,netPence:5000,vatPence:0,taxStatus:'invoice_snapshot',vatRateBps:0,vatNumber:'',reviewHash:'b'.repeat(64)};
          await first.query("select approve_invoice_credit($1,$2,$3,'2026-04-11',5000,'Synthetic reviewed credit',$4,$5,$6)",[invoice,credit,b.balance_stamp,JSON.stringify(document),creditPath,'c'.repeat(64)]);
          invoices.push(invoice);credits.push(credit);
          settlements.push((await first.query('select id from active_invoice_allocations where transaction_id=$1',[original])).rows[0].id);
          links.push((await first.query('select id from active_refunds where original_transaction_id=$1 and refund_transaction_id=$2',[original,tx[2]])).rows[0].id);
        }
        return {imports,tx,invoices,credits,settlements,links};
      }
      const f=await fixture(),args=[f.credits[1],f.settlements[1],f.links[1],await stamp(),randomUUID()];
      const saved=(await first.query(assignSql,args)).rows[0].r;
      const reviewed=await stamp(),request=randomUUID();
      await first.query('begin');
      await first.query("update invoices set next_reminder_at='2026-06-01T09:00:00Z' where id=$1",[f.invoices[1]]);
      const pending=second.query(undoSql,[saved.assignment_id,reviewed,request]);pending.catch(()=>{});
      const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true,'Reversal must actually wait for the invoice row');
      await assert.rejects(pending,/Reconciliation changed/);
      assert.notEqual(await stamp(),reviewed);
      assert.equal((await admin.query('select count(*)::int n from active_invoice_refund_assignments where id=$1',[saved.assignment_id])).rows[0].n,1);
      assert.equal((await admin.query('select count(*)::int n from invoice_refund_requests where user_id=$1 and request_id=$2',[owner,request])).rows[0].n,0);
      assert.equal((await admin.query('select count(*)::int n from invoice_refund_assignment_reversals where assignment_id=$1',[saved.assignment_id])).rows[0].n,0);
      const undoArgs=[saved.assignment_id,await stamp(),randomUUID()];
      const undone=(await first.query(undoSql,undoArgs)).rows[0].r;
      await first.query("update invoices set next_reminder_at='2026-07-01T09:00:00Z' where id=$1",[f.invoices[1]]);
      assert.deepEqual((await second.query(undoSql,undoArgs)).rows[0].r,undone,'Historical reversal recovery precedes changed live context');
      assert.deepEqual((await second.query(assignSql,args)).rows[0].r,saved,'Historical approval cannot reactivate a reversed assignment');
      await assert.rejects(second.query("select reverse_invoice_refund_assignment($1,$2,'Changed reviewed reason',$3)",undoArgs),/request changed/);
      const balances=async(f:Awaited<ReturnType<typeof fixture>>)=>(await admin.query('select id,allocated_pence,returned_pence,retained_cash_pence,outstanding_pence,refund_due_pence from invoice_payment_balances where id=any($1::uuid[]) order by id',[f.invoices])).rows;
      const net=async(f:Awaited<ReturnType<typeof fixture>>)=>Number((await admin.query("select coalesce(sum(amount*100*effect_sign),0) p from financial_records where user_id=$1 and bank_transaction_id=any($2::uuid[]) and status='approved'",[owner,f.tx])).rows[0].p);
      const plan=(f:Awaited<ReturnType<typeof fixture>>,root:string,reviewed:string)=>root.endsWith('_import')?
        {sql:"select reverse_source_import_reviewed($1,$2,'Synthetic shared assignment import undo',$3) r",args:[f.imports[root==='refund_import'?1:0],reviewed,randomUUID()]}:
        {sql:"select reverse_refund_closure($1,$2,$3,'Synthetic shared assignment closure undo',$4) r",args:[root,f.tx[root==='refund'?2:0],reviewed,randomUUID()]};
      // The assigned child belongs to original 1; an original-0 root must still
      // discover that sibling dependency through the shared cash observation.
      for(const root of ['original','refund','refund_import','original_import'])for(const assignmentFirst of [true,false]){
        const f=await fixture(),reviewed=await stamp(),parent=plan(f,root,reviewed),args=[f.credits[1],f.settlements[1],f.links[1],reviewed,randomUUID()];
        const before=(await admin.query('select id,source_row_id,signed_amount_pence,transaction_date from bank_transactions where id=any($1::uuid[]) order by id',[f.tx])).rows;
        assert.equal(await net(f),10000);
        await first.query('begin');
        if(assignmentFirst)await first.query(assignSql,args);else await first.query(parent.sql,parent.args);
        const pending=assignmentFirst?second.query(parent.sql,parent.args):second.query(assignSql,args);pending.catch(()=>{});
        const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true,root+' must serialize governed decisions');
        await assert.rejects(pending,/context changed|Reconciliation changed/);
        const links=(await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=$1',[f.tx[2]])).rows[0].n;
        assert.equal(links,assignmentFirst?2:0,root);
        assert.equal((await admin.query('select count(*)::int n from active_invoice_refund_assignments where refund_id=any($1::uuid[])',[f.links])).rows[0].n,assignmentFirst?1:0);
        if(assignmentFirst){
          const fresh=plan(f,root,await stamp());await assert.rejects(second.query(fresh.sql,fresh.args),/assignment/i);
          assert.equal(await net(f),10000,'Blocked parent cannot exclude any accounting effect');
        }else{
          const fresh=[...args];fresh[3]=await stamp();await assert.rejects(second.query(assignSql,fresh),/original receipt allocation|active customer refund/);
          assert.equal(await net(f),root==='original_import'?0:20000);
          const versions=(await admin.query('select id,classification,decision_version from bank_transactions where id=any($1::uuid[])',[f.tx])).rows;
          for(const row of versions){const reset=row.id===f.tx[2]||root==='original_import';assert.equal(row.decision_version,reset?2:1);assert.equal(row.classification,reset?'Unknown':'Business');}
        }
        assert.deepEqual((await admin.query('select id,source_row_id,signed_amount_pence,transaction_date from bank_transactions where id=any($1::uuid[]) order by id',[f.tx])).rows,before);
        for(let i=0;i<f.imports.length;i++)assert.equal((await admin.query('select status from record_imports where id=$1',[f.imports[i]])).rows[0].status,!assignmentFirst&&root===(i?'refund_import':'original_import')?'discarded':'review');
      }
      for(const sameRequest of [true,false]){
        const f=await fixture(),approval=[f.credits[1],f.settlements[1],f.links[1],await stamp(),randomUUID()];
        const assignment=(await first.query(assignSql,approval)).rows[0].r;
        const undo=[assignment.assignment_id,await stamp(),randomUUID()],competing=[...undo];if(!sameRequest)competing[2]=randomUUID();
        await first.query('begin');const saved=(await first.query(undoSql,undo)).rows[0].r;
        const pending=second.query(undoSql,competing);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/Reconciliation changed/);
        assert.equal((await admin.query('select count(*)::int n from invoice_refund_assignment_reversals where assignment_id=$1',[assignment.assignment_id])).rows[0].n,1);
        assert.equal((await admin.query('select count(*)::int n from active_invoice_refund_assignments where id=$1',[assignment.assignment_id])).rows[0].n,0);
        assert.equal(await net(f),10000);
      }
      for(const sameRequest of [true,false]){
        const f=await fixture(),args=[f.credits[1],f.settlements[1],f.links[1],await stamp(),randomUUID()];
        const before=await net(f);await first.query('begin');const saved=(await first.query(assignSql,args)).rows[0].r;
        const competing=[...args];if(!sameRequest)competing[4]=randomUUID();
        const pending=second.query(assignSql,competing);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/Reconciliation changed/);
        const excessive=[...args];excessive[3]=await stamp();excessive[4]=randomUUID();await assert.rejects(second.query(assignSql,excessive),/remaining refund cash/);
        const sibling=[f.credits[0],f.settlements[0],f.links[0],args[3],randomUUID()];
        await assert.rejects(second.query(assignSql,sibling),/Reconciliation changed/);sibling[3]=await stamp();
        const other=(await first.query(assignSql,sibling)).rows[0].r;
        assert.equal(await net(f),before,'Two child assignments create zero accounting effects');
        for(const b of await balances(f)){assert.equal(Number(b.returned_pence),5000);assert.equal(Number(b.retained_cash_pence),5000);assert.equal(Number(b.outstanding_pence),0);}
        assert.equal((await admin.query('select count(*)::int n from active_invoice_refund_assignments where refund_id=any($1::uuid[])',[f.links])).rows[0].n,2);
        const firstUndo=[saved.assignment_id,await stamp(),randomUUID()],firstResult=(await first.query(undoSql,firstUndo)).rows[0].r;
        for(const root of ['original','refund_import','original_import']){const blocked=plan(f,root,await stamp());await assert.rejects(first.query(blocked.sql,blocked.args),/assignment/i);}
        const staleParent=plan(f,'original',await stamp());await first.query('begin');
        await first.query(undoSql,[other.assignment_id,await stamp(),randomUUID()]);
        const parentPending=second.query(staleParent.sql,staleParent.args);parentPending.catch(()=>{});const parentLocked=await waitsForLock();await first.query('commit');assert.equal(parentLocked,true);
        await assert.rejects(parentPending,/context changed/);
        const freshParent=plan(f,'original',await stamp());await first.query(freshParent.sql,freshParent.args);
        assert.equal(await net(f),20000);assert.equal((await admin.query('select count(*)::int n from active_refunds where refund_transaction_id=$1',[f.tx[2]])).rows[0].n,0);
        assert.deepEqual((await second.query(assignSql,args)).rows[0].r,saved);assert.deepEqual((await second.query(assignSql,sibling)).rows[0].r,other);
        assert.deepEqual((await second.query(undoSql,firstUndo)).rows[0].r,firstResult);
        assert.equal((await admin.query('select count(*)::int n from active_invoice_refund_assignments where refund_id=any($1::uuid[])',[f.links])).rows[0].n,0,'Saved request recovery creates no new active assignment');
      }
    });
    await serialSubtest(t,'FX evidence review serializes requests, parent/receipt revisions, registration changes and source-object loss',async()=>{
      async function auth(connection:typeof first){await connection.query('reset role');await connection.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await connection.query('set role authenticated');}
      const reviewSql='select review_fx_document_evidence($1) r',stamp=async()=>(await first.query('select fx_evidence_review_stamp() s')).rows[0].s;
      async function fixture(){
        await auth(first);await auth(second);
        const docAttempt=randomUUID(),hash=randomBytes(32).toString('hex'),path=`PRIVATE/${owner}/${docAttempt}.enc`;
        await admin.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[docAttempt,owner,hash,JSON.stringify([{hash,size:100,media_type:'application/pdf',path,key_id:'PRIVATE',name_encrypted:'PRIVATE'}])]);
        await admin.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[path]);
        await admin.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')",[owner,docAttempt]);
        const document=(await admin.query('select id from evidence_documents where user_id=$1 and file_hash=$2',[owner,hash])).rows[0].id;
        const upload=await attempt(randomBytes(32).toString('hex'));
        const imp=(await admin.query(ingestSql,[owner,upload,JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'PRIVATE',date:'2026-04-06',signed_pence:79000,currency:'GBP',description:'PRIVATE',reference:'PRIVATE',fingerprint:randomBytes(32).toString('hex')}])])).rows[0].result.import_id;
        const tx=(await admin.query('select id from bank_transactions where import_id=$1',[imp])).rows[0].id;
        const intent={schema_version:'fx-document-fact-intent/1',ruleset_id:'vibecount-currencies/1',family_id:randomUUID(),expected_ordinal:0,kind:'invoice',state:'verified',document_id:document,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:{currency:'USD',original_total_minor:100000,invoice_date:'2026-04-05',invoice_reference:'FX-NATIVE'},human_read_original:true,expected_stamp:await stamp(),rationale:'Synthetic original checked by human fixture',request_id:randomUUID()};
        return {intent,tx,path};
      }
      for(const sameRequest of [true,false]){
        const f=await fixture(),before=(await first.query('select reconciliation_export_stamp() s')).rows[0].s;
        await first.query('begin');const saved=(await first.query(reviewSql,[JSON.stringify(f.intent)])).rows[0].r;
        const competing={...f.intent,request_id:sameRequest?f.intent.request_id:randomUUID()};
        const pending=second.query(reviewSql,[JSON.stringify(competing)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from fx_document_fact_revisions where family_id=$1',[f.intent.family_id])).rows[0].n,1);
        assert.equal((await first.query('select reconciliation_export_stamp() s')).rows[0].s,before);
      }
      function conversion(f:Awaited<ReturnType<typeof fixture>>,parent:string,context:string){return {...f.intent,family_id:randomUUID(),kind:'conversion',invoice_evidence_revision_id:parent,transaction_id:f.tx,transaction_version:0,data:{rate:{direction:'target_major_per_source_major',source_currency:'USD',target_currency:'GBP',numerator:'79',denominator:'100'},conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:100000,gbp_cash_portion_pence:79000,fee_mode:'none'},expected_stamp:context,request_id:randomUUID()};}
      for(const parentFirst of [true,false]){
        const f=await fixture(),parent=(await first.query(reviewSql,[JSON.stringify(f.intent)])).rows[0].r;
        const context=await stamp(),proof=conversion(f,parent.revision_id,context),revision={...f.intent,expected_ordinal:1,state:'provisional',human_read_original:false,expected_stamp:context,request_id:randomUUID()};
        await first.query('begin');await first.query(reviewSql,[JSON.stringify(parentFirst?revision:proof)]);
        const pending=second.query(reviewSql,[JSON.stringify(parentFirst?proof:revision)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/context changed/);
        if(parentFirst)await assert.rejects(second.query(reviewSql,[JSON.stringify({...proof,expected_stamp:await stamp()})]),/current verified invoice/);
        else{
          await first.query(reviewSql,[JSON.stringify({...revision,expected_stamp:await stamp()})]);
          const c=(await first.query('select read_fx_evidence_catalog() r')).rows[0].r;
          assert.equal(c.facts.find((r:{family_id:string})=>r.family_id===proof.family_id).source_current,false);
        }
      }
      const category=(await admin.query("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
      for(const classifyFirst of [true,false]){
        const f=await fixture(),parent=(await first.query(reviewSql,[JSON.stringify(f.intent)])).rows[0].r,proof=conversion(f,parent.revision_id,await stamp());
        const classify="select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic separate receipt approval')";
        await first.query('begin');if(classifyFirst)await first.query(classify,[f.tx,category]);else await first.query(reviewSql,[JSON.stringify(proof)]);
        const pending=classifyFirst?second.query(reviewSql,[JSON.stringify(proof)]):second.query(classify,[f.tx,category]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(classifyFirst)await assert.rejects(pending,/context changed/);else{
          await pending;const c=(await first.query('select read_fx_evidence_catalog() r')).rows[0].r;
          assert.equal(c.facts.find((r:{family_id:string})=>r.family_id===proof.family_id).source_current,false);
        }
        assert.equal((await admin.query('select decision_version from bank_transactions where id=$1',[f.tx])).rows[0].decision_version,1);
        assert.equal((await admin.query("select count(*)::int n from financial_records where bank_transaction_id=$1 and status='approved'",[f.tx])).rows[0].n,1,'Only the separate receipt classification creates income');
      }
      // Hold a barrier after the second stamp was computed, before source capture.
      // This reproduces a real new registration rather than relying on sleep timing.
      {
        const f=await fixture(),parent=(await first.query(reviewSql,[JSON.stringify(f.intent)])).rows[0].r;
        const docAttempt=randomUUID(),hash=randomBytes(32).toString('hex'),path=`PRIVATE/${docAttempt}.enc`;
        await admin.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[docAttempt,owner,hash,JSON.stringify([{hash,size:100,media_type:'application/pdf',path,key_id:'PRIVATE',name_encrypted:'PRIVATE'}])]);
        await admin.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[path]);
        await admin.query("select register_document_intake($1,$2,2024,'other','opaque-evidence/1')",[owner,docAttempt]);
        const document=(await admin.query('select id from evidence_documents where user_id=$1 and file_hash=$2',[owner,hash])).rows[0].id;
        async function newRegistrationAttempt(){const id=randomUUID();await admin.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) select $1,user_id,file_hash,'uploaded',planned_objects from document_upload_attempts where id=$2",[id,docAttempt]);return id;}
        const proof={...conversion(f,parent.revision_id,await stamp()),document_id:document};
        const before=(await first.query('select read_fx_evidence_catalog() r')).rows[0].r;
        assert.equal(before.documents.find((d:{id:string})=>d.id===document).source.registration.purpose,'other');
        const financialBefore=(await first.query('select reconciliation_export_stamp() s')).rows[0].s;
        const originalStamp=(await admin.query("select pg_get_functiondef('public.fx_evidence_review_stamp()'::regprocedure) d")).rows[0].d as string;
        const barrier='903561723501';
        const heldStamp=originalStamp.replace('return result;',`if current_setting('vibecount.fx_stamp_barrier',true)='enabled' then
          perform set_config('vibecount.fx_stamp_reads',(coalesce(nullif(current_setting('vibecount.fx_stamp_reads',true),''),'0')::integer+1)::text,false);
          if current_setting('vibecount.fx_stamp_reads',true)='2' then perform pg_advisory_xact_lock(${barrier});end if;
        end if;return result;`);
        let outcome:{rows?:{r:unknown}[];error?:Error}|undefined,pending:Promise<unknown>|undefined;
        await admin.query(heldStamp);await admin.query('select pg_advisory_lock('+barrier+')');
        try{
          await second.query("select set_config('vibecount.fx_stamp_barrier','enabled',false),set_config('vibecount.fx_stamp_reads','0',false)");
          pending=second.query(reviewSql,[JSON.stringify(proof)]).then(r=>{outcome={rows:r.rows};},error=>{outcome={error};});
          const locked=await waitsForLock();assert.equal(locked,true,'Writer must reach the post-stamp test barrier');
          // FOR SHARE on the existing document permits registration foreign-key locks.
          await admin.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')",[owner,await newRegistrationAttempt()]);
        }finally{
          await admin.query('select pg_advisory_unlock('+barrier+')');if(pending)await pending;
          await admin.query(originalStamp);await second.query("select set_config('vibecount.fx_stamp_barrier','disabled',false)");
        }
        if(outcome?.rows){
          const saved=(await admin.query('select source_snapshot from fx_document_fact_revisions where family_id=$1',[proof.family_id])).rows[0];
          assert.equal(saved.source_snapshot.document_source.registration.purpose,'invoice','Predecessor persisted the new registration instead of the reviewed other registration');
        }
        assert.ok(outcome?.error,'A source registration committed after the reviewed stamp must reject, not save a different registration');
        assert.match(outcome.error.message,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from fx_document_fact_revisions where family_id=$1',[proof.family_id])).rows[0].n,0);
        assert.equal((await admin.query('select count(*)::int n from fx_document_fact_requests where user_id=$1 and request_id=$2',[owner,proof.request_id])).rows[0].n,0);
        const refreshed={...proof,expected_stamp:await stamp()},saved=(await first.query(reviewSql,[JSON.stringify(refreshed)])).rows[0].r;
        const captured=(await admin.query('select source_snapshot from fx_document_fact_revisions where id=$1',[saved.revision_id])).rows[0].source_snapshot;
        await admin.query("select register_document_intake($1,$2,2026,'invoice','opaque-evidence/1')",[owner,await newRegistrationAttempt()]);
        assert.deepEqual((await second.query(reviewSql,[JSON.stringify(refreshed)])).rows[0].r,saved);
        const retained=(await first.query('select read_fx_evidence_catalog() r')).rows[0].r.facts.find((r:{id:string})=>r.id===saved.revision_id);
        assert.deepEqual(retained.source_snapshot,captured);assert.equal(retained.usable,true);
        assert.equal((await first.query('select reconciliation_export_stamp() s')).rows[0].s,financialBefore);
      }
      // Private read receipts must not race object deletion or a newly selected invoice registration.
      let sourceRegistration=1;
      for(const sourceChange of ['object','registration'])for(const checkFirst of [true,false]){
        const source=await fixture(),evidence=(await first.query(reviewSql,[JSON.stringify(source.intent)])).rows[0].r;
        const snapshot=(await admin.query('select source_snapshot from fx_document_fact_revisions where id=$1',[evidence.revision_id])).rows[0].source_snapshot;
        const input={schema_version:'invoice-source-read-intent/1',request_id:randomUUID(),fact_revision_id:evidence.revision_id,reason:'Synthetic source-read race metadata only'};
        const args=[owner,JSON.stringify(input),JSON.stringify(snapshot),'verified'],readSql='select record_invoice_source_read($1,$2,$3,$4) r';
        const mutate=async(connection:typeof first)=>{
          if(sourceChange==='object')return connection.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[source.path]);
          const batch=randomUUID(),item='00000000-0000-0000-0000-'+String(sourceRegistration++).padStart(12,'0');
          await connection.query("insert into document_batches(id,user_id,root_document_id,tax_year_start,purpose,parser_version) values($1,$2,$3,2024,'invoice','opaque-evidence/1')",[batch,owner,source.intent.document_id]);
          return connection.query("insert into document_batch_items(id,user_id,batch_id,document_id,ordinal,original_name_encrypted) values($1,$2,$3,$4,0,'SYNTHETIC')",[item,owner,batch,source.intent.document_id]);
        };
        await first.query('reset role;set role service_role;begin');await second.query('reset role;set role service_role');
        if(checkFirst){
          const saved=(await first.query(readSql,args)).rows[0].r;
          const pending=mutate(second);pending.catch(()=>{});
          const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await pending;
          assert.deepEqual((await second.query(readSql,args)).rows[0].r,saved,'Historical recovery precedes deleted-source checks');
        }else{
          await mutate(first);
          await assert.rejects(second.query(readSql,args),/lock|could not obtain/);await first.query('commit');
          assert.equal((await admin.query('select count(*)::int n from invoice_source_read_checks where user_id=$1 and request_id=$2',[owner,input.request_id])).rows[0].n,0);
        }
        const fresh={...input,request_id:randomUUID()};
        await assert.rejects(second.query(readSql,[owner,JSON.stringify(fresh),JSON.stringify(snapshot),'verified']),/source changed/);
        assert.equal((await admin.query('select count(*)::int n from invoice_source_read_checks where user_id=$1 and request_id=$2',[owner,fresh.request_id])).rows[0].n,0);
      }
      // SQL metadata proofs here isolate transaction races. Real encrypted bytes
      // are independently exercised by the external action and source-read suites.
      const captureSql='select capture_external_invoice($1,$2) r';
      async function externalFixture(){
        const f=await fixture();f.intent.data.invoice_reference='FX-'+randomUUID();
        const fact=(await first.query(reviewSql,[JSON.stringify(f.intent)])).rows[0].r;
        const snapshot=(await admin.query('select source_snapshot from fx_document_fact_revisions where id=$1',[fact.revision_id])).rows[0].source_snapshot;
        const client=(await admin.query("insert into clients(user_id,name) values($1,$2) returning id",[owner,'Synthetic external '+randomUUID()])).rows[0].id;
        const intent={schema_version:'external-invoice-intent/1',request_id:randomUUID(),invoice_id:randomUUID(),client_id:client,source_fact_revision_id:fact.revision_id,source_fact_family_id:f.intent.family_id,expected_revision:0,expected_updated_at:null as string|null,expected_stamp:(await first.query('select external_invoice_review_stamp() s')).rows[0].s,original_sha256:snapshot.document_source.document.file_sha256,human_read_original:true,reason:'Synthetic external capture race'};
        return {...f,intent,sourceIntent:f.intent,snapshot};
      }
      async function boundProof(intent:Awaited<ReturnType<typeof externalFixture>>['intent'],snapshot:unknown){
        const proof={schema_version:'invoice-source-read-intent/2',request_id:intent.request_id,fact_revision_id:intent.source_fact_revision_id,reason:intent.reason,capture_intent:intent};
        return (await admin.query("select record_invoice_source_read($1,$2,$3,'verified') r",[owner,JSON.stringify(proof),JSON.stringify(snapshot)])).rows[0].r.id;
      }
      for(const correction of [false,true])for(const sameRequest of [true,false]){
        const f=await externalFixture();let intent=f.intent;
        if(correction){
          const check=await boundProof(intent,f.snapshot);await first.query(captureSql,[JSON.stringify(intent),check]);
          const successor={...f.sourceIntent,expected_ordinal:1,expected_stamp:await stamp(),request_id:randomUUID(),data:{...f.sourceIntent.data,original_total_minor:200001}};
          const fact=(await first.query(reviewSql,[JSON.stringify(successor)])).rows[0].r;
          const updated=(await first.query('select to_jsonb(updated_at) t from invoices where id=$1',[intent.invoice_id])).rows[0].t;
          intent={...intent,request_id:randomUUID(),source_fact_revision_id:fact.revision_id,expected_revision:1,expected_updated_at:updated,expected_stamp:(await first.query('select external_invoice_review_stamp() s')).rows[0].s};
        }
        const check=await boundProof(intent,f.snapshot),competing={...intent,request_id:sameRequest?intent.request_id:randomUUID()},otherCheck=sameRequest?check:await boundProof(competing,f.snapshot);
        const effects=(await admin.query('select count(*)::int n from financial_records')).rows[0].n;
        await auth(first);await auth(second);await first.query('begin');const saved=(await first.query(captureSql,[JSON.stringify(intent),check])).rows[0].r;
        const pending=second.query(captureSql,[JSON.stringify(competing),otherCheck]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/context changed/);
        const versions=(await admin.query('select version from invoice_revisions where invoice_id=$1 order by version',[intent.invoice_id])).rows.map(r=>r.version);
        assert.deepEqual(versions,correction?[1,2]:[1]);assert.equal((await admin.query('select count(*)::int n from invoices where source_fact_family_id=$1',[intent.source_fact_family_id])).rows[0].n,1);
        assert.equal((await admin.query('select count(*)::int n from financial_records')).rows[0].n,effects);
      }
      for(const change of ['object','client'])for(const captureFirst of [true,false]){
        const f=await externalFixture(),check=await boundProof(f.intent,f.snapshot);
        async function mutate(connection:typeof first){
          if(change==='object')return connection.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
          return connection.query("update clients set name='Changed synthetic client '||id::text where id=$1",[f.intent.client_id]);
        }
        await auth(first);await auth(second);
        if(captureFirst){
          await first.query('begin');const saved=(await first.query(captureSql,[JSON.stringify(f.intent),check])).rows[0].r;
          await second.query('reset role;set role service_role');const pending=mutate(second);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await pending;
          await auth(second);assert.deepEqual((await second.query(captureSql,[JSON.stringify(f.intent),check])).rows[0].r,saved);
        }else{
          await first.query('reset role;set role service_role;begin');await mutate(first);
          await assert.rejects(second.query(captureSql,[JSON.stringify(f.intent),check]),/lock|could not obtain/);await first.query('commit');
          await assert.rejects(second.query(captureSql,[JSON.stringify(f.intent),check]),/context changed/);
          assert.equal((await admin.query('select count(*)::int n from invoices where id=$1',[f.intent.invoice_id])).rows[0].n,0);
        }
      }
      const lotSql='select bind_fx_conversion_lot($1,$2,$3,$4,$5) r';
      async function lotFixture(){
        const f=await externalFixture(),check=await boundProof(f.intent,f.snapshot);
        const canonical=(await first.query(captureSql,[JSON.stringify(f.intent),check])).rows[0].r;
        await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic separate GBP receipt')",[f.tx,category]);
        const conversionIntent={...f.sourceIntent,family_id:randomUUID(),kind:'conversion',invoice_evidence_revision_id:f.intent.source_fact_revision_id,transaction_id:f.tx,transaction_version:1,expected_stamp:await stamp(),request_id:randomUUID(),data:{rate:{direction:'target_major_per_source_major',source_currency:'USD',target_currency:'GBP',numerator:'79',denominator:'100'},conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:100000,gbp_cash_portion_pence:79000,fee_mode:'none'}};
        const conversion=(await first.query(reviewSql,[JSON.stringify(conversionIntent)])).rows[0].r;
        return {...f,args:[owner,randomUUID(),f.intent.invoice_id,canonical.revision_id,conversion.revision_id]};
      }
      for(const sameLot of [true,false]){
        const f=await lotFixture();await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        const bound=(await first.query(lotSql,f.args)).rows[0].r,competing=[...f.args];if(!sameLot)competing[1]=randomUUID();
        const pending=second.query(lotSql,competing);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameLot)assert.deepEqual((await pending).rows[0].r,bound);else await assert.rejects(pending,/single conversion-family/);
        assert.equal((await admin.query('select count(*)::int n from fx_conversion_lots where conversion_fact_revision_id=$1',[f.args[4]])).rows[0].n,1);
      }
      for(const bindingFirst of [true,false]){
        const f=await lotFixture();await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        if(bindingFirst){
          const bound=(await first.query(lotSql,f.args)).rows[0].r;
          const pending=second.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await pending;
          await assert.rejects(second.query(lotSql,f.args),/current verified/);
          assert.deepEqual((await admin.query('select to_jsonb(l) r from fx_conversion_lots l where id=$1',[bound.id])).rows[0].r,bound);
        }else{
          await first.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
          await assert.rejects(second.query(lotSql,f.args),/lock|could not obtain/);await first.query('commit');await assert.rejects(second.query(lotSql,f.args),/current verified/);
          assert.equal((await admin.query('select count(*)::int n from fx_conversion_lots where id=$1',[f.args[1]])).rows[0].n,0);
        }
        assert.equal((await admin.query('select count(*)::int n from invoice_settlements where invoice_id=$1',[f.intent.invoice_id])).rows[0].n,0);
      }
      const fxApprove='select approve_fx_invoice_allocations($1) r',fxReverse='select reverse_fx_conversion_lot($1,$2,$3,$4) r';
      const settlementStamp=async()=>(await first.query('select fx_settlement_review_stamp() s')).rows[0].s;
      async function settlementFixture(){
        const f=await lotFixture();await auth(first);const proof=(await first.query('select family_id from fx_document_fact_revisions where id=$1',[f.args[4]])).rows[0];
        const fxIntent={schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:f.tx,receipt_version:1,expected_stamp:await settlementStamp(),rationale:'Synthetic dimensioned race',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
         allocations:[{invoice_id:f.args[2],invoice_revision_id:f.args[3],invoice_minor:100000,cash_minor:79000,conversion_date:'2026-04-06',rate:{direction:'target_major_per_source_major',source_currency:'USD',target_currency:'GBP',numerator:'79',denominator:'100'},invoice_evidence_id:f.sourceIntent.family_id,invoice_evidence_revision_id:f.intent.source_fact_revision_id,conversion_evidence_id:proof.family_id,conversion_evidence_revision_id:f.args[4],conversion_lot_id:f.args[1],conversion_lot_version:0}]};
        return {...f,fxIntent};
      }
      // New private proof recording must serialize exact retries and freeze real
      // source mutations. The competing source writer is privileged here, so a
      // permission denial cannot masquerade as a successful lock assertion.
      const proofSql='select record_fx_settlement_source_check($1,$2,$3,$4) r';
      async function proofFixture(){
        const f=await settlementFixture();
        const sources=(await admin.query('select fx_settlement_source_context($1,$2,true) r',[owner,JSON.stringify(f.fxIntent)])).rows[0].r;
        return{...f,proofArgs:[owner,JSON.stringify(f.fxIntent),JSON.stringify(sources),'verified']};
      }
      {
        const f=await proofFixture();await first.query('reset role;set role service_role;begin');await second.query('reset role;set role service_role');
        const saved=(await first.query(proofSql,f.proofArgs)).rows[0].r,pending=second.query(proofSql,f.proofArgs);pending.catch(()=>{});
        const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);assert.deepEqual((await pending).rows[0].r,saved);
        assert.equal((await admin.query('select count(*)::int n from fx_settlement_source_checks where user_id=$1 and request_id=$2',[owner,f.fxIntent.request_id])).rows[0].n,1);
      }
      for(const sourceChange of ['object','receipt'])for(const proofFirst of [true,false]){
        const f=await proofFixture();await first.query('reset role');await second.query('reset role');
        const mutate=async(client:typeof first)=>sourceChange==='object'?client.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]):client.query('update financial_records set amount=amount-1 where bank_transaction_id=$1',[f.tx]);
        await first.query('begin');
        if(proofFirst){
          const saved=(await first.query(proofSql,f.proofArgs)).rows[0].r,pending=mutate(second);pending.catch(()=>{});
          const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await pending;
          assert.deepEqual((await second.query(proofSql,f.proofArgs)).rows[0].r,saved,'Exact source proof recovery precedes current source validation');
        }else{
          await mutate(first);
          if(sourceChange==='object'){await assert.rejects(second.query(proofSql,f.proofArgs),/lock|could not obtain/);await first.query('commit');}
          else{const pending=second.query(proofSql,f.proofArgs);pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await assert.rejects(pending,/financial context changed|Current settlement source/);}
          await assert.rejects(second.query(proofSql,f.proofArgs),/financial context changed|Current settlement source/);
          assert.equal((await admin.query('select count(*)::int n from fx_settlement_source_checks where user_id=$1 and request_id=$2',[owner,f.fxIntent.request_id])).rows[0].n,0);
        }
        const fresh={...f.fxIntent,request_id:randomUUID()};await assert.rejects(second.query(proofSql,[owner,JSON.stringify(fresh),f.proofArgs[2],'verified']),/financial context changed|Current settlement source/);
        assert.equal((await admin.query('select count(*)::int n from invoice_settlements where transaction_id=$1',[f.tx])).rows[0].n,0);
      }
      for(const sameRequest of [true,false]){
        const f=await proofFixture();await auth(first);await auth(second);await first.query('begin');
        const sql='select prepare_fx_reviewed_request($1,$2,true) r',args=['allocate',JSON.stringify(f.fxIntent)];
        const saved=(await first.query(sql,args)).rows[0].r,competing={...f.fxIntent,request_id:sameRequest?f.fxIntent.request_id:randomUUID()},pending=second.query(sql,['allocate',JSON.stringify(competing)]);pending.catch(()=>{});
        const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/existing saved FX request/);
        await first.query('select cancel_fx_reviewed_request($1,true)',[f.fxIntent.request_id]);
      }
      for(const commitFirst of [true,false]){
        const f=await proofFixture();await auth(first);await first.query("select prepare_fx_reviewed_request('allocate',$1,true)",[JSON.stringify(f.fxIntent)]);
        await first.query('reset role;set role service_role');await first.query(proofSql,f.proofArgs);await auth(first);await auth(second);await first.query('begin');
        const commitSql='select commit_fx_reviewed_request($1,true) r',cancelSql='select cancel_fx_reviewed_request($1,true) r';
        const saved=(await first.query(commitFirst?commitSql:cancelSql,[f.fxIntent.request_id])).rows[0].r;
        const pending=second.query(commitFirst?cancelSql:commitSql,[f.fxIntent.request_id]);pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);await assert.rejects(pending,commitFirst?/already exists/:/cancelled/);
        assert.equal((await admin.query('select count(*)::int n from invoice_settlements where request_id=$1',[f.fxIntent.request_id])).rows[0].n,commitFirst?1:0);
        if(commitFirst)assert.deepEqual((await second.query(commitSql,[f.fxIntent.request_id])).rows[0].r,saved);
      }
      for(const sameRequest of [true,false]){
        const f=await settlementFixture();await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        const saved=(await first.query(fxApprove,[JSON.stringify(f.fxIntent)])).rows[0].r;
        const competing={...f.fxIntent,request_id:sameRequest?f.fxIntent.request_id:randomUUID()};const pending=second.query(fxApprove,[JSON.stringify(competing)]);pending.catch(()=>{});
        const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        if(sameRequest)assert.deepEqual((await pending).rows[0].r,saved);else await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_invoice_allocations where transaction_id=$1',[f.tx])).rows[0].n,1);
      }
      for(const fxFirst of [true,false]){
        const f=await settlementFixture(),native=(await admin.query("insert into invoices(user_id,client_id,number,invoice_date,description,amount,payment_terms,status) values($1,$2,$3,'2026-04-05','Synthetic native FX cash race',790,'30 days','finalised') returning id,to_jsonb(updated_at) reviewed_updated",[owner,f.intent.client_id,'NATIVE-FX-'+randomUUID()])).rows[0];
        f.fxIntent.expected_stamp=await settlementStamp();const args=[f.tx,1,JSON.stringify([{invoice_id:native.id,invoice_updated_at:native.reviewed_updated,amount_pence:79000}]),'Synthetic shared cash capacity',randomUUID(),0];
        await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        if(fxFirst)await first.query(fxApprove,[JSON.stringify(f.fxIntent)]);else await first.query('select approve_invoice_allocations($1,$2,$3,$4,$5,$6)',args);
        const pending=fxFirst?second.query('select approve_invoice_allocations($1,$2,$3,$4,$5,$6)',args):second.query(fxApprove,[JSON.stringify(f.fxIntent)]);pending.catch(()=>{});
        const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/context changed|allocations changed/);
        const allocated=(await admin.query('select sum(amount_pence)::bigint p from active_invoice_allocations where transaction_id=$1',[f.tx])).rows[0].p;assert.equal(Number(allocated),79000);
      }
      for(const recordFirst of [true,false]){
        const f=await settlementFixture();await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        if(recordFirst){
          await first.query('update financial_records set amount=amount-1 where bank_transaction_id=$1',[f.tx]);
          const pending=second.query(fxApprove,[JSON.stringify(f.fxIntent)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
          await assert.rejects(pending,/context changed/);
          assert.equal((await admin.query('select count(*)::int n from active_invoice_allocations where transaction_id=$1',[f.tx])).rows[0].n,0);
        }else{
          await first.query(fxApprove,[JSON.stringify(f.fxIntent)]);const pending=second.query('update financial_records set amount=amount-1 where bank_transaction_id=$1',[f.tx]);pending.catch(()=>{});
          const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/Reverse active FX/);
          assert.equal(Number((await admin.query('select amount from financial_records where bank_transaction_id=$1',[f.tx])).rows[0].amount),790);
        }
      }
      for(const refundFirst of [true,false]){
        const f=await settlementFixture(),upload=await attempt(randomBytes(32).toString('hex'));
        await first.query('reset role;set role service_role');
        const imported=(await first.query(ingestSql,[owner,upload,JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:-100,currency:'GBP',description:'Synthetic FX/refund race',reference:'',fingerprint:randomBytes(32).toString('hex')}])])).rows[0].result.import_id;
        const refund=(await admin.query('select id from bank_transactions where import_id=$1',[imported])).rows[0].id;
        await auth(first);const group=(await first.query('select refund_group_stamp($1) s',[f.tx])).rows[0].s;
        f.fxIntent.expected_stamp=await settlementStamp();const args=[f.tx,1,refund,0,group,'Synthetic refund versus FX approval',randomUUID()],sql='select approve_refund($1,$2,$3,$4,$5,$6,$7) r';
        await first.query('reset role');await auth(second);await second.query('reset role');await first.query('begin');
        if(refundFirst)await first.query(sql,args);else await first.query(fxApprove,[JSON.stringify(f.fxIntent)]);
        const pending=refundFirst?second.query(fxApprove,[JSON.stringify(f.fxIntent)]):second.query(sql,args);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);
        await assert.rejects(pending,refundFirst?/context changed/:/linked FX/);
        assert.equal((await admin.query('select count(*)::int n from active_refunds where original_transaction_id=$1',[f.tx])).rows[0].n,refundFirst?1:0);
        assert.equal((await admin.query("select count(*)::int n from active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash' and transaction_id=$1",[f.tx])).rows[0].n,refundFirst?0:1);
        if(refundFirst){await auth(first);const current={...f.fxIntent,request_id:randomUUID(),expected_stamp:await settlementStamp()};await first.query('reset role');await assert.rejects(first.query(fxApprove,[JSON.stringify(current)]),/source-linked GBP/);await auth(first);assert.deepEqual((await first.query(sql,args)).rows[0].r,(await second.query(sql,args)).rows[0].r);}
      }
      for(const reverseFirst of [true,false]){
        const f=await settlementFixture();f.fxIntent.allocations[0].invoice_minor=50000;f.fxIntent.allocations[0].cash_minor=39500;
        await first.query('reset role');await first.query(fxApprove,[JSON.stringify(f.fxIntent)]);await auth(second);await second.query('reset role');
        const context=await settlementStamp(),next={...f.fxIntent,request_id:randomUUID(),expected_stamp:context,allocations:[{...f.fxIntent.allocations[0],conversion_lot_version:1}]},undo=[f.args[1],context,'Synthetic full FX reversal race',randomUUID()];
        await first.query('begin');if(reverseFirst)await first.query(fxReverse,undo);else await first.query(fxApprove,[JSON.stringify(next)]);
        const pending=reverseFirst?second.query(fxApprove,[JSON.stringify(next)]):second.query(fxReverse,undo);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true);await assert.rejects(pending,/context changed/);
        assert.equal((await admin.query('select count(*)::int n from active_invoice_allocations where transaction_id=$1',[f.tx])).rows[0].n,reverseFirst?0:2);
      }
      const f=await fixture();await first.query('reset role;set role service_role;begin');
      await first.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
      const pending=second.query(reviewSql,[JSON.stringify(f.intent)]);pending.catch(()=>{});const locked=await waitsForLock();await first.query('commit');assert.equal(locked,true,'Evidence writer must wait on actual object metadata deletion');
      await assert.rejects(pending,/context changed/);await auth(first);
      assert.equal((await admin.query('select count(*)::int n from fx_document_fact_revisions where family_id=$1',[f.intent.family_id])).rows[0].n,0);
      assert.equal((await admin.query('select count(*)::int n from fx_document_fact_requests where user_id=$1 and request_id=$2',[owner,f.intent.request_id])).rows[0].n,0);
    });
    await serialSubtest(t,'read-only refund closure retains one MVCC snapshot while reversal commits independently',async()=>{
      async function auth(client:typeof first){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await client.query('set role authenticated');}
      await first.query('reset role');await first.query('set role service_role');const upload=await attempt(randomBytes(32).toString('hex'));
      const rows=[-10000,10000].map((amount,i)=>({row_number:i+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-10',signed_pence:amount,currency:'GBP',description:'Synthetic closure snapshot',reference:'',fingerprint:randomBytes(32).toString('hex')}));
      const imp=(await first.query(ingestSql,[owner,upload,JSON.stringify(rows)])).rows[0].result.import_id;
      const tx=(await admin.query('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number',[imp])).rows;
      const category=(await admin.query("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
      await auth(first);await first.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic closure source')",[tx[0].id,category]);
      const group=(await first.query('select refund_group_stamp($1) s',[tx[0].id])).rows[0].s;
      await first.query("select approve_refund($1,1,$2,0,$3,'Synthetic closure refund',$4)",[tx[0].id,tx[1].id,group,randomUUID()]);
      await auth(second);await first.query('begin isolation level repeatable read');
      const before=(await first.query("select read_refund_reversal_graph('original',$1) g",[tx[0].id])).rows[0].g;
      const stamp=(await second.query('select refund_group_stamp($1) s',[tx[0].id])).rows[0].s;
      await second.query("select reverse_refund_group($1,$2,'Synthetic concurrent reversal',$3)",[tx[0].id,stamp,randomUUID()]);
      const held=(await first.query("select read_refund_reversal_graph('original',$1) g",[tx[0].id])).rows[0].g;
      assert.deepEqual(held,before);assert.equal(refundReversalClosure(owner,{kind:'original',id:tx[0].id},held).observed_refund_cash_pence,10000);await first.query('commit');
      const after=(await first.query("select read_refund_reversal_graph('original',$1) g",[tx[0].id])).rows[0].g;
      assert.equal(after.links.length,0);assert.notEqual(after.stamp,before.stamp);assert.equal(refundReversalClosure(owner,{kind:'original',id:tx[0].id},after).observed_refund_cash_pence,0);
    });
    await serialSubtest(t,'category identity is immutable while legacy category deletion and linking serialize safely',async()=>{
      await first.query('reset role');await second.query('reset role');
      for(const linkFirst of [true,false]){
        const category=(await admin.query("insert into record_categories(user_id,name,record_type) values ($1,$2,'expense') returning id",[owner,'Synthetic deletion '+randomUUID()])).rows[0].id;
        await first.query('begin');
        if(linkFirst)await first.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',1,'Synthetic category race','manual','draft',$2)",[owner,category]);
        else await first.query('delete from record_categories where id=$1',[category]);
        const pending=linkFirst?second.query('delete from record_categories where id=$1',[category]):second.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',1,'Synthetic category race','manual','draft',$2)",[owner,category]);
        pending.catch(()=>{});const waiting=await waitsForLock();await first.query('commit');assert.equal(waiting,true);
        if(linkFirst)await pending;else await assert.rejects(pending,/Category must/);
        assert.equal((await admin.query('select count(*)::int n from financial_records where category_id=$1',[category])).rows[0].n,0);
      }
      const category=(await admin.query("insert into record_categories(user_id,name,record_type) values ($1,$2,'expense') returning id",[owner,'Synthetic identity '+randomUUID()])).rows[0].id;
      await assert.rejects(admin.query("update record_categories set record_type='income' where id=$1",[category]),/immutable/);
      await assert.rejects(admin.query('update record_categories set user_id=$1 where id=$2',[randomUUID(),category]),/immutable/);
    });
  },
);
