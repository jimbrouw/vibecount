import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
test("reviewed identities preserve sources, legitimate repetitions and single accounting effects", async (t) => {
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
    return (
      await db.query<{
        id: string;
      }>(
        "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic bank','starling','bank','1234') returning id",
        [user],
      )
    ).rows[0].id;
  }
  const bank = await account(),
    foreignBank = await account(other),
    secondBank = await account();
  const category = (
    await db.query<{
      id: string;
    }>(
      "select id from record_categories where is_default and record_type='income' limit 1",
    )
  ).rows[0].id;
  const hash = () => randomBytes(32).toString("hex");
  async function auth(user: string | null = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? "",
    ]);
    await db.exec(user ? "set role authenticated" : "set role anon");
  }
  async function ingest(
    fp: string,
    count = 1,
    accountId = bank,
    user = owner,
    signedPence = 150000,
  ) {
    await db.exec("reset role");
    const path = "fixture/" + randomUUID();
    const attempt = (
      await db.query<{
        id: string;
      }>(
        "insert into source_upload_attempts(user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'test',100,'uploaded') returning id",
        [user, accountId, hash(), path],
      )
    ).rows[0].id;
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('source-evidence',$1)",
      [path],
    );
    const rows = Array.from({ length: count }, (_, i) => ({
      row_number: i + 2,
      row_hash: hash(),
      raw_encrypted: "synthetic-ciphertext",
      date: "2026-04-05",
      signed_pence: signedPence,
      currency: "GBP",
      description: "Synthetic freelance receipt",
      reference: "synthetic",
      fingerprint: fp,
    }));
    const imp = (
      await db.query<{
        r: {
          import_id: string;
        };
      }>(
        "select ingest_source_csv($1,$2,'synthetic.csv','test-v1','{}',$3::jsonb) r",
        [user, attempt, JSON.stringify(rows)],
      )
    ).rows[0].r.import_id;
    const tx = (
      await db.query<{
        id: string;
      }>(
        "select id from bank_transactions where import_id=$1 order by source_row_id",
        [imp],
      )
    ).rows.map((r) => r.id);
    await auth();
    return { imp, tx };
  }
  async function stamp(id: string) {
    return (
      await db.query<{
        s: string;
      }>("select duplicate_group_stamp($1) s", [id])
    ).rows[0].s;
  }
  async function state(id: string) {
    return (
      await db.query<{
        id: string;
        classification: string;
        dedupe_status: string;
        decision_version: number;
        recognized_pence: string;
        active_duplicate_decision_id: string | null;
        has_financial_dependencies: boolean;
      }>("select * from duplicate_review_transactions where id=$1", [id])
    ).rows[0];
  }
  async function verdict(
    tx: string,
    retained: string | null,
    kind = "duplicate",
    s?: string,
    request = randomUUID(),
    reason = "Checked original evidence",
  ) {
    return (
      await db.query<{
        r: {
          decision_id: string;
          removed_income_pence: number;
          removed_expense_pence: number;
        };
      }>("select approve_duplicate_decision($1,$2,$3,$4,$5,$6) r", [
        tx,
        retained,
        kind,
        s ?? (await stamp(tx)),
        reason,
        request,
      ])
    ).rows[0].r;
  }
  async function reverse(
    id: string,
    tx: string,
    s?: string,
    request = randomUUID(),
  ) {
    return (
      await db.query<{
        r: {
          reversal_id: string;
        };
      }>(
        "select reverse_duplicate_decision($1,$2,'Reviewed identity undo',$3) r",
        [id, s ?? (await stamp(tx)), request],
      )
    ).rows[0].r;
  }
  async function classify(tx: string) {
    const v = (await state(tx)).decision_version;
    await db.query(
      "select review_bank_transaction($1,$2,'Business',$3,10000,'Verified freelance receipt')",
      [tx, v, category],
    );
  }
  async function reverseImport(id: string) {
    const c=(await db.query<{c:{financial_stamp:string;duplicate_references:unknown[]}}>('select read_source_import_reversal_context($1) c',[id])).rows[0].c;
    if(c.duplicate_references.length)await assert.rejects(db.query("select reverse_source_import_reviewed($1,$2,'Blocked retained source',$3)",[id,c.financial_stamp,randomUUID()]),/duplicate references/);
    await db.query(
      "select reverse_source_import($1,source_import_summary($1)->>'stamp','Reviewed source reversal')",
      [id],
    );
  }
  await serialSubtest(t,
    "byte-different overlaps remain unresolved until an idempotent evidence-backed verdict",
    async () => {
      const fp = hash(),
        a = await ingest(fp),
        b = await ingest(fp);
      const s = await stamp(b.tx[0]),
        request = randomUUID();
      assert.equal((await state(a.tx[0])).dedupe_status, "clear");
      assert.equal((await state(b.tx[0])).dedupe_status, "needs_review");
      await assert.rejects(classify(b.tx[0]), /Resolve possible duplicates/);
      await classify(a.tx[0]);
      await assert.rejects(
        verdict(b.tx[0], a.tx[0], "duplicate", s),
        /Evidence changed/,
      );
      const fresh = await stamp(b.tx[0]),
        result = await verdict(b.tx[0], a.tx[0], "duplicate", fresh, request);
      assert.deepEqual(
        await verdict(b.tx[0], a.tx[0], "duplicate", fresh, request),
        result,
      );
      await assert.rejects(
        verdict(b.tx[0], a.tx[0], "distinct", fresh, request),
        /Request ID/,
      );
      assert.equal((await state(b.tx[0])).dedupe_status, "duplicate");
      const snapshot = (
        await db.query<{
          subject_snapshot: {
            file_hash: string;
            row_hash: string;
          };
          retained_snapshot: {
            file_hash: string;
            row_hash: string;
          };
          cohort_snapshot: unknown[];
        }>(
          "select subject_snapshot,retained_snapshot,cohort_snapshot from duplicate_decisions where id=$1",
          [result.decision_id],
        )
      ).rows[0];
      assert.equal(snapshot.cohort_snapshot.length, 2);
      assert.notEqual(
        snapshot.subject_snapshot.file_hash,
        snapshot.retained_snapshot.file_hash,
      );
      assert.equal(snapshot.subject_snapshot.row_hash.length, 64);
      assert.doesNotMatch(
        JSON.stringify(snapshot),
        /raw_encrypted|object_path|key_id/,
      );
      const totals = (
        await db.query<{
          p: string;
          n: number;
        }>(
          "select sum(amount*100*effect_sign)::text p,count(*)::int n from financial_records where status='approved' and user_id=$1",
          [owner],
        )
      ).rows[0];
      assert.equal(Number(totals.p), 150000);
      assert.equal(totals.n, 1);
      await assert.rejects(
        verdict(a.tx[0], b.tx[0]),
        /Reverse existing identity/,
      );
      await assert.rejects(
        reverseImport(a.imp),
        /Reverse duplicate references/,
      );
      assert.equal((await state(a.tx[0])).classification, "Business");
      await reverseImport(b.imp);
      await assert.rejects(
        reverseImport(a.imp),
        /Reverse duplicate references/,
      );
      const r = await reverse(result.decision_id, b.tx[0]);
      assert.ok(r.reversal_id);
      assert.equal((await state(b.tx[0])).dedupe_status, "needs_review");
      await db.query("select reopen_source_import($1)", [b.imp]);
      assert.equal((await state(b.tx[0])).classification, "Unknown");
      assert.equal(Number((await state(b.tx[0])).recognized_pence), 0);
      await reverseImport(a.imp);
      assert.equal((await state(a.tx[0])).classification, "Unknown");
    },
  );
  await serialSubtest(t,
    "same-file genuine repeated payments preserve both postings; reversing identity restores no approvals",
    async () => {
      const a = await ingest(hash(), 2);
      await classify(a.tx[0]);
      await classify(a.tx[1]);
      const before = await state(a.tx[0]);
      const d = await verdict(a.tx[0], null, "distinct");
      assert.equal((await state(a.tx[0])).classification, "Business");
      assert.equal(Number((await state(a.tx[0])).recognized_pence), 150000);
      assert.equal(
        (await state(a.tx[0])).decision_version,
        before.decision_version + 1,
      );
      const ds = await stamp(a.tx[0]),
        request = randomUUID();
      const r = await reverse(d.decision_id, a.tx[0], ds, request);
      assert.deepEqual(await reverse(d.decision_id, a.tx[0], ds, request), r);
      assert.equal((await state(a.tx[0])).classification, "Unknown");
      assert.equal(Number((await state(a.tx[0])).recognized_pence), 0);
      const distinct = await verdict(a.tx[0], null, "distinct");
      assert.ok(distinct.decision_id);
      assert.equal(Number((await state(a.tx[0])).recognized_pence), 0);
      await classify(a.tx[0]);
      await reverse(distinct.decision_id, a.tx[0]);
      await verdict(a.tx[0], null, "distinct");
      const suppressed = await verdict(a.tx[1], a.tx[0]);
      assert.equal(suppressed.removed_income_pence, 150000);
      assert.equal(Number((await state(a.tx[1])).recognized_pence), 0);
      await assert.rejects(
        verdict(a.tx[0], null, "distinct"),
        /Reverse existing identity/,
      );
      await reverse(suppressed.decision_id, a.tx[1]);
      assert.equal((await state(a.tx[1])).dedupe_status, "needs_review");
    },
  );
  await serialSubtest(t,
    "separate payments still need classification; new imports invalidate prior cohort reviews",
    async () => {
      const fp = hash(),
        a = await ingest(fp),
        b = await ingest(fp);
      const old = await stamp(b.tx[0]);
      await ingest(fp);
      await assert.rejects(
        verdict(b.tx[0], null, "distinct", old),
        /Evidence changed/,
      );
      await verdict(b.tx[0], null, "distinct");
      assert.equal((await state(b.tx[0])).classification, "Unknown");
      await classify(b.tx[0]);
      const third = await ingest(fp);
      await assert.rejects(verdict(third.tx[0], null, "invalid"), /verdict/);
      await assert.rejects(
        verdict(third.tx[0], a.tx[0], "distinct"),
        /no retained/,
      );
      const singleton = await ingest(hash());
      await assert.rejects(
        verdict(singleton.tx[0], null, "distinct"),
        /overlapping evidence/,
      );
    },
  );
  await serialSubtest(t,
    "owned account/fingerprint checks, no chains, immutable history and direct-write denial",
    async () => {
      const fp = hash(),
        a = await ingest(fp),
        b = await ingest(fp),
        c = await ingest(fp);
      const foreign = await ingest(fp, 1, foreignBank, other),
        different = await ingest(fp, 1, secondBank),
        otherFingerprint = await ingest(hash());
      await assert.rejects(
        verdict(b.tx[0], foreign.tx[0]),
        /Native review requires actual GBP bank cash/,
      );
      await assert.rejects(
        verdict(b.tx[0], different.tx[0]),
        /matching observation/,
      );
      await assert.rejects(
        verdict(b.tx[0], otherFingerprint.tx[0]),
        /matching observation/,
      );
      const d = await verdict(b.tx[0], a.tx[0]);
      await assert.rejects(verdict(c.tx[0], b.tx[0]), /chains/);
      await assert.rejects(
        db.query(
          "update duplicate_decisions set rationale='changed' where id=$1",
          [d.decision_id],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "select apply_duplicate_state($1,'clear',null,true,'bypass')",
          [b.tx[0]],
        ),
        /permission denied/,
      );
      await db.exec("reset role; set role service_role");
      await assert.rejects(
        db.query(
          "update bank_transactions set dedupe_status='clear' where id=$1",
          [b.tx[0]],
        ),
        /reviewed duplicate/,
      );
      await assert.rejects(
        db.query("delete from duplicate_decisions where id=$1", [
          d.decision_id,
        ]),
        /permission denied/,
      );
      await auth(other);
      assert.equal(
        (await db.query("select * from duplicate_decisions")).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from duplicate_review_transactions where id=$1",
            [a.tx[0]],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(verdict(b.tx[0], a.tx[0]), /not found/);
      await assert.rejects(reverse(d.decision_id, b.tx[0]), /not found/);
      await auth(null);
      await assert.rejects(
        db.query("select * from duplicate_decisions"),
        /permission denied/,
      );
      await assert.rejects(verdict(b.tx[0], a.tx[0]), /permission denied/);
      await auth();
    },
  );
  await serialSubtest(t,
    "active invoice receipt allocations cannot be silently suppressed or invalidated",
    async () => {
      const a = await ingest(hash(), 2);
      await classify(a.tx[0]);
      await db.exec("reset role");
      const client = (
        await db.query<{
          id: string;
        }>(
          "insert into clients(user_id,name) values ($1,'Synthetic client') returning id",
          [owner],
        )
      ).rows[0].id;
      const invoice = (
        await db.query<{
          id: string;
        }>(
          "insert into invoices(user_id,client_id,number,invoice_date,due_date,description,amount,status,currency) values ($1,$2,'SYNTHETIC-DUPE','2026-04-05','2026-04-20','Synthetic invoice',1500,'finalised','GBP') returning id",
          [owner, client],
        )
      ).rows[0].id;
      await auth();
      const version = (await state(a.tx[0])).decision_version;
      const updated = (
        await db.query<{
          updated_at: string;
        }>("select updated_at::text from invoices where id=$1", [invoice])
      ).rows[0].updated_at;
      await db.query(
        "select approve_invoice_allocations($1,$2,$3::jsonb,'Reviewed allocation',$4,0)",
        [
          a.tx[0],
          version,
          JSON.stringify([
            {
              invoice_id: invoice,
              amount_pence: 150000,
              invoice_updated_at: updated,
            },
          ]),
          randomUUID(),
        ],
      );
      assert.equal((await state(a.tx[0])).has_financial_dependencies, true);
      await assert.rejects(
        verdict(a.tx[0], a.tx[1]),
        /Reverse receipt allocations/,
      );
      assert.equal(Number((await state(a.tx[0])).recognized_pence), 150000);
    },
  );
  await serialSubtest(t,
    "transfers and both refund endpoints prevent identity changes and reversals",
    async () => {
      const outgoing = await ingest(hash(), 2, bank, owner, -150000),
        incoming = await ingest(hash(), 1, secondBank);
      await db.query(
        "select approve_transfer_pair($1,0,$2,0,'transfer','Reviewed source transfer',$3)",
        [outgoing.tx[0], incoming.tx[0], randomUUID()],
      );
      assert.equal(
        (await state(outgoing.tx[0])).has_financial_dependencies,
        true,
      );
      await assert.rejects(
        verdict(outgoing.tx[0], outgoing.tx[1]),
        /Reverse receipt allocations/,
      );
      const original = await ingest(hash(), 2);
      const identity = await verdict(original.tx[0], null, "distinct");
      await classify(original.tx[0]);
      const refund = await ingest(hash(), 2, bank, owner, -10000);
      const version = (await state(original.tx[0])).decision_version;
      const group = (
        await db.query<{
          s: string;
        }>("select refund_group_stamp($1) s", [original.tx[0]])
      ).rows[0].s;
      await db.query(
        "select approve_refund($1,$2,$3,0,$4,'Checked refund evidence',$5)",
        [original.tx[0], version, refund.tx[0], group, randomUUID()],
      );
      assert.equal(
        (await state(original.tx[0])).has_financial_dependencies,
        true,
      );
      assert.equal(
        (await state(refund.tx[0])).has_financial_dependencies,
        true,
      );
      await assert.rejects(
        reverse(identity.decision_id, original.tx[0]),
        /Reverse dependent/,
      );
      await assert.rejects(
        verdict(refund.tx[0], refund.tx[1]),
        /Reverse receipt allocations/,
      );
      const net = (
        await db.query<{
          p: string;
        }>(
          "select sum(amount*100*effect_sign)::text p from financial_records where status='approved' and bank_transaction_id in ($1,$2)",
          [original.tx[0], refund.tx[0]],
        )
      ).rows[0];
      assert.equal(Number(net.p), 140000);
    },
  );
});
