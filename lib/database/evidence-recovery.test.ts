import {serialSubtest} from './serial-subtest.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";
import {
  persistSourceCsv,
  type SourceAttempt,
} from "../records/source-persistence.ts";
import {
  persistDocumentIntake,
  type DocumentAttempt,
} from "../records/document-persistence.ts";
import {
  verifySourceRecovery,
  verifyDocumentRecovery,
  type RecoveryTransport,
} from "../records/evidence-recovery.ts";
import { parseEvidenceKeyring } from "../records/evidence-keyring.ts";
import { readSourceCsv, suggestMapping } from "../records/source-csv.ts";
import { prepareDocumentIntake } from "../records/document-intake.ts";
import {
  decryptSource,
  documentNameContext,
} from "../records/source-crypto.ts";

test("evidence recovery is atomic, owner-isolated, replayable and preserves separate content/name key provenance", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const legacyOwner = randomUUID(),
    legacyAttempt = randomUUID();
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (name === "20261017200000_evidence_recovery.sql") {
      await db.query("insert into auth.users values ($1)", [legacyOwner]);
      const item = {
        hash: "8".repeat(64),
        size: 100,
        media_type: "application/pdf",
        path: `${legacyOwner}/${legacyAttempt}/0.enc`,
        key_id: "historical",
        name_encrypted: "historical-encrypted-name",
      };
      await db.query(
        "insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values ($1,$2,$3,'uploaded',$4)",
        [legacyAttempt, legacyOwner, item.hash, JSON.stringify([item])],
      );
      await db.query(
        "insert into storage.objects(bucket_id,name) values ('document-evidence',$1)",
        [item.path],
      );
      await db.query(
        "select register_document_intake($1,$2,2025,'employment','opaque-evidence/1')",
        [legacyOwner, legacyAttempt],
      );
    }
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  }
  assert.equal(
    (
      await db.query<{ key_id: string }>(
        "select key_id from document_name_keys where attempt_id=$1",
        [legacyAttempt],
      )
    ).rows[0].key_id,
    "historical",
  );

  const owner = randomUUID(),
    other = randomUUID(),
    oldKey = randomBytes(32),
    newKey = randomBytes(32);
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  const ring = parseEvidenceKeyring({
    VIBECOUNT_SOURCE_KEY_ID: "new",
    VIBECOUNT_SOURCE_ENCRYPTION_KEYS: JSON.stringify([
      { id: "old", key: oldKey.toString("base64") },
      { id: "new", key: newKey.toString("base64") },
    ]),
  });
  const objects = new Map<string, Uint8Array>();
  async function service() {
    await db.exec("reset role; set role service_role");
  }
  async function auth(id = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  const cryptoTransport: RecoveryTransport = {
    async read(_b, path) {
      return objects.get(path) ?? null;
    },
    async upload(bucket, path, cipher) {
      objects.set(path, cipher);
      await db.query(
        "insert into storage.objects(bucket_id,name) values ($1,$2)",
        [bucket, path],
      );
    },
  };
  async function transition(
    table: string,
    id: string,
    from: string[],
    state: string,
  ) {
    const r = await db.query(
      `update ${table} set state=$1 where id=$2 and user_id=$3 and state=any($4::text[]) returning id`,
      [state, id, owner, from],
    );
    if (!r.rows.length) throw new Error("State changed");
  }
  async function source(existingAccount?: string) {
    await service();
    const account =
      existingAccount ??
      (
        await db.query<{ id: string }>(
          "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic recovery','starling','bank','1234') returning id",
          [owner],
        )
      ).rows[0].id;
    const bytes = await readFile(
        new URL("../../fixtures/synthetic-starling.csv", import.meta.url),
      ),
      mapping = suggestMapping(readSourceCsv(bytes.toString())[0], "starling");
    let attempt: SourceAttempt | null = null;
    await assert.rejects(
      persistSourceCsv(
        { owner, account, bytes, filename: "synthetic.csv", mapping },
        oldKey,
        "old",
        {
          async createAttempt(a) {
            attempt = a;
            await db.query(
              "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,recovery_plan) values ($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                a.id,
                a.user_id,
                a.account_id,
                a.file_hash,
                a.object_path,
                a.key_id,
                a.size_bytes,
                JSON.stringify(a.recovery_plan),
              ],
            );
          },
          async upload(path, b) {
            await cryptoTransport.upload("source-evidence", path, b);
          },
          async transition(id, _o, from, to) {
            await transition("source_upload_attempts", id, from, to);
          },
          async register() {
            throw new Error("Simulated registration failure");
          },
        },
      ),
      /registration failure/,
    );
    return attempt!;
  }
  async function document(
    year = 2025,
    key = oldKey,
    keyId = "old",
    fail = true,
  ) {
    await service();
    const files = await prepareDocumentIntake(
      "synthetic-invoices.zip",
      await readFile(
        new URL(
          "../../fixtures/document-evidence/synthetic-invoices.zip",
          import.meta.url,
        ),
      ),
      "invoice",
    );
    let attempt: DocumentAttempt | null = null;
    let n = 0;
    const run = persistDocumentIntake(
      owner,
      files,
      year,
      "invoice",
      key,
      keyId,
      {
        async createAttempt(a) {
          attempt = a;
          await db.query(
            "insert into document_upload_attempts(id,user_id,file_hash,planned_objects,recovery_plan) values ($1,$2,$3,$4,$5)",
            [
              a.id,
              a.user_id,
              a.file_hash,
              JSON.stringify(a.planned_objects),
              JSON.stringify(a.recovery_plan),
            ],
          );
        },
        async upload(path, b) {
          if (fail && n++ === 1) throw new Error("Simulated partial archive");
          await cryptoTransport.upload("document-evidence", path, b);
        },
        async transition(id, _o, from, to) {
          await transition("document_upload_attempts", id, from, to);
        },
        async register(id, user, y, p) {
          return (
            await db.query<{
              r: { batch_id: string; created: boolean; files: number };
            }>(
              "select register_document_intake($1,$2,$3,$4,'opaque-evidence/1') r",
              [user, id, y, p],
            )
          ).rows[0].r;
        },
      },
    );
    if (fail) await assert.rejects(run, /partial archive/);
    else await run;
    return { attempt: attempt!, files };
  }
  async function stamp(id: string, kind = "source") {
    return (
      await db.query<{ s: string }>(
        "select stamp s from evidence_recovery_attempts where id=$1 and kind=$2",
        [id, kind],
      )
    ).rows[0].s;
  }
  async function commit(
    id: string,
    kind: string,
    s: string,
    manifest: string,
    rows: unknown,
    request = randomUUID(),
    reason = "Reviewed evidence recovery",
    user = owner,
  ) {
    return (
      await db.query<{ r: Record<string, unknown> }>(
        "select complete_evidence_recovery($1,$2,$3,$4,$5,$6::jsonb,$7,$8) r",
        [user, kind, id, s, manifest, JSON.stringify(rows), reason, request],
      )
    ).rows[0].r;
  }
  await serialSubtest(t,
    "verified CSV retry creates Unknown observations once with immutable audit and stable terminal replay",
    async () => {
      const a = await source(),
        s = await stamp(a.id),
        verified = await verifySourceRecovery(a, owner, ring, cryptoTransport),
        request = randomUUID();
      const result = await commit(
        a.id,
        "source",
        s,
        verified.manifest,
        verified.rows,
        request,
      );
      assert.equal(result.created, true);
      assert.equal(result.transactions, 8);
      assert.deepEqual(
        await commit(
          a.id,
          "source",
          s,
          verified.manifest,
          verified.rows,
          request,
        ),
        result,
      );
      await assert.rejects(
        commit(
          a.id,
          "source",
          s,
          verified.manifest,
          verified.rows,
          request,
          "Changed review",
        ),
        /another review/,
      );
      const rows = (
        await db.query<{ classification: string }>(
          "select classification from bank_transactions where import_id=$1",
          [result.import_id],
        )
      ).rows;
      assert.equal(rows.length, 8);
      assert.ok(rows.every((r) => r.classification === "Unknown"));
      const before = (
        await db.query<{ n: number }>(
          "select count(*)::int n from source_import_events",
        )
      ).rows[0].n;
      const replay = (
        await db.query<{ r: { import_id: string } }>(
          "select ingest_source_csv($1,$2,$3,$4,$5,$6) r",
          [
            owner,
            a.id,
            a.recovery_plan.filename,
            a.recovery_plan.parser,
            JSON.stringify(a.recovery_plan.mapping),
            JSON.stringify(verified.rows),
          ],
        )
      ).rows[0].r;
      assert.equal(replay.import_id, result.import_id);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from source_import_events",
          )
        ).rows[0].n,
        before,
      );
      await assert.rejects(
        db.query(
          "update source_upload_attempts set state='failed' where id=$1",
          [a.id],
        ),
        /cannot be downgraded/,
      );
      await assert.rejects(
        db.query(
          "update source_upload_attempts set recovery_plan='{}' where id=$1",
          [a.id],
        ),
        /immutable/,
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "stale scope, pending uploads, cross-owner calls and late audit failure cannot partially register",
    async () => {
      const a = await source(),
        verified = await verifySourceRecovery(a, owner, ring, cryptoTransport),
        s = await stamp(a.id);
      await assert.rejects(
        commit(a.id, "source", "invalid", verified.manifest, verified.rows),
        /scope changed/,
      );
      await assert.rejects(
        commit(
          a.id,
          "source",
          s,
          verified.manifest,
          verified.rows,
          randomUUID(),
          "Wrong owner",
          other,
        ),
        /Owned upload attempt unavailable/,
      );
      await db.query(
        "update source_upload_attempts set state='pending' where id=$1",
        [a.id],
      );
      await assert.rejects(
        commit(
          a.id,
          "source",
          await stamp(a.id),
          verified.manifest,
          verified.rows,
        ),
        /scope changed/,
      );
      await db.query(
        "update source_upload_attempts set state='failed' where id=$1",
        [a.id],
      );
      const legacy = randomUUID();
      await db.query(
        "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'old',100,'failed')",
        [
          legacy,
          owner,
          a.account_id,
          a.file_hash,
          `${owner}/${a.account_id}/${legacy}.enc`,
        ],
      );
      await assert.rejects(
        commit(
          legacy,
          "source",
          await stamp(legacy),
          verified.manifest,
          verified.rows,
        ),
        /fresh mapping review/,
      );

      await db.exec(
        "reset role; create function public.reject_recovery_audit_fixture() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end; $$; create trigger reject_recovery_audit_fixture before insert on evidence_recovery_requests for each row execute function reject_recovery_audit_fixture();",
      );
      await service();
      await assert.rejects(
        commit(a.id, "source", s, verified.manifest, verified.rows),
        /audit unavailable/,
      );
      assert.equal(
        (
          await db.query<{ state: string }>(
            "select state from source_upload_attempts where id=$1",
            [a.id],
          )
        ).rows[0].state,
        "failed",
      );
      assert.equal(
        (
          await db.query("select id from record_imports where account_id=$1", [
            a.account_id,
          ])
        ).rows.length,
        0,
      );
      assert.ok(objects.has(a.object_path));
      await db.exec(
        "reset role; drop trigger reject_recovery_audit_fixture on evidence_recovery_requests; drop function reject_recovery_audit_fixture();",
      );
    },
  );
  await serialSubtest(t,
    "partial document recovery requires all original members, is scope-stable and retains separate name keys after rotation",
    async () => {
      const old = await document();
      const s = await stamp(old.attempt.id, "document");
      await assert.rejects(
        commit(old.attempt.id, "document", s, "a".repeat(64), null),
        /object missing/,
      );
      assert.equal(
        (
          await db.query<{ state: string }>(
            "select state from document_upload_attempts where id=$1",
            [old.attempt.id],
          )
        ).rows[0].state,
        "failed",
      );
      const v = await verifyDocumentRecovery(
          old.attempt,
          owner,
          ring,
          cryptoTransport,
        ),
        request = randomUUID();
      const recovered = await commit(
        old.attempt.id,
        "document",
        s,
        v.manifest,
        null,
        request,
      );
      assert.equal(recovered.files, old.files.length);
      assert.deepEqual(
        await commit(old.attempt.id, "document", s, v.manifest, null, request),
        recovered,
      );
      const newer = await document(2026, newKey, "new", false);
      const names = (
        await db.query<{
          key_id: string;
          name_key_id: string;
          ordinal: number;
          original_name_encrypted: string;
        }>(
          `select d.key_id,k.key_id name_key_id,i.ordinal,i.original_name_encrypted from document_batch_items i join document_name_keys k on k.batch_item_id=i.id and k.user_id=i.user_id join evidence_documents d on d.id=i.document_id and d.user_id=i.user_id join document_batches b on b.id=i.batch_id and b.user_id=i.user_id where b.tax_year_start=2026 and b.user_id=$1 order by i.ordinal`,
          [owner],
        )
      ).rows;
      assert.equal(names.length, newer.files.length);
      for (const row of names) {
        assert.equal(row.key_id, "old");
        assert.equal(row.name_key_id, "new");
        assert.equal(
          decryptSource(
            Buffer.from(row.original_name_encrypted, "base64"),
            ring.key(row.name_key_id),
            documentNameContext(owner, newer.attempt.file_hash, row.ordinal),
          ).toString(),
          newer.files[row.ordinal].name,
        );
      }
      const count = (
        await db.query<{ n: number }>(
          "select count(*)::int n from document_intake_events",
        )
      ).rows[0].n;
      await db.query(
        "select register_document_intake($1,$2,2026,'invoice','opaque-evidence/1')",
        [owner, newer.attempt.id],
      );
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from document_intake_events",
          )
        ).rows[0].n,
        count,
      );
      await assert.rejects(
        db.query(
          "select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')",
          [owner, newer.attempt.id],
        ),
        /scope changed/,
      );
      assert.equal(
        (await db.query("select * from financial_records")).rows.length,
        0,
      );
    },
  );
  await serialSubtest(t,
    "recovery of an already registered original preserves reviewed financial treatment",
    async () => {
      const first = await source(),
        verified = await verifySourceRecovery(
          first,
          owner,
          ring,
          cryptoTransport,
        );
      const original = await commit(
        first.id,
        "source",
        await stamp(first.id),
        verified.manifest,
        verified.rows,
      );
      await auth();
      const tx = (
        await db.query<{ id: string }>(
          "select id from bank_transactions where import_id=$1 and signed_amount_pence>0 order by id limit 1",
          [original.import_id],
        )
      ).rows[0].id;
      const category = (
        await db.query<{ id: string }>(
          "select id from record_categories where is_default and record_type='income' limit 1",
        )
      ).rows[0].id;
      await db.query(
        "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed original receipt')",
        [tx, category],
      );
      await service();
      const prior = (
        await db.query(
          "select id,status,amount from financial_records where bank_transaction_id=$1",
          [tx],
        )
      ).rows;
      const duplicate = await source(first.account_id),
        retry = await verifySourceRecovery(
          duplicate,
          owner,
          ring,
          cryptoTransport,
        );
      const reused = await commit(
        duplicate.id,
        "source",
        await stamp(duplicate.id),
        retry.manifest,
        retry.rows,
      );
      assert.equal(reused.import_id, original.import_id);
      assert.equal(reused.created, false);
      assert.equal(reused.transactions, 0);
      assert.deepEqual(
        (
          await db.query(
            "select id,status,amount from financial_records where bank_transaction_id=$1",
            [tx],
          )
        ).rows,
        prior,
      );
    },
  );
  await serialSubtest(t, "deletion targets prevent a successful recovery request being replayed as available", async()=>{
    const a=await source(),s=await stamp(a.id),verified=await verifySourceRecovery(a,owner,ring,cryptoTransport),request=randomUUID();
    const result=await commit(a.id,"source",s,verified.manifest,verified.rows,request);
    const before=(await db.query("select * from evidence_recovery_requests where request_id=$1",[request])).rows;
    await db.exec("reset role");
    await db.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'source-evidence',$3,$4)",[owner,randomUUID(),a.object_path,a.file_hash]);
    await service();
    await assert.rejects(commit(a.id,"source",s,verified.manifest,verified.rows,request),/marked for deletion/);
    await assert.rejects(db.query("select assert_evidence_attempt_retained($1,'source',$2)",[owner,a.id]),/marked for deletion/);
    assert.deepEqual((await db.query("select * from evidence_recovery_requests where request_id=$1",[request])).rows,before);
    assert.equal((await db.query("select * from record_imports where id=$1",[result.import_id])).rows.length,1);
  });
  await serialSubtest(t,
    "safe projections enforce owner isolation and never expose ciphertext coordinates, key metadata or writable history",
    async () => {
      await auth();
      const rows = (
        await db.query<Record<string, unknown>>(
          "select * from evidence_recovery_attempts",
        )
      ).rows;
      assert.ok(rows.length > 0);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /object_path|planned_objects|name_encrypted|key_id|raw_encrypted/,
      );
      for (const sql of [
        "select object_path from source_upload_attempts",
        "select planned_objects from document_upload_attempts",
        "select * from document_name_keys",
        "update evidence_recovery_requests set reason='changed'",
        "delete from source_upload_attempts",
      ])
        await assert.rejects(db.query(sql), /permission denied/);
      await assert.rejects(
        db.query(
          "select complete_evidence_recovery($1,'source',$2,'s',$3,null,'reason',$4)",
          [owner, randomUUID(), "a".repeat(64), randomUUID()],
        ),
        /permission denied/,
      );
      await auth(other);
      assert.equal(
        (await db.query("select * from evidence_recovery_attempts")).rows
          .length,
        0,
      );
      assert.equal(
        (await db.query("select * from evidence_recovery_requests")).rows
          .length,
        0,
      );
      await db.exec("reset role; set role anon");
      await assert.rejects(
        db.query("select * from evidence_recovery_attempts"),
        /permission denied/,
      );
    },
  );
});
