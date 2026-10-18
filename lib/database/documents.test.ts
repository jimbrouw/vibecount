import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("document evidence is atomic, idempotent, owner-isolated and creates no accounting entries", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(name, dir), "utf8"));
    const owner = randomUUID(),
      other = randomUUID();
    await db.query("insert into auth.users values ($1),($2)", [owner, other]);
    async function makeAttempt(
      root: string,
      children: string[],
      missingLast = false,
    ) {
      await db.exec("reset role");
      const id = randomUUID();
      const items = [root, ...children].map((hash, i) => ({
        hash: hash.repeat(64),
        size: 100,
        media_type:
          i === 0 && children.length ? "application/zip" : "application/pdf",
        path: `${owner}/${id}/${i}.enc`,
        key_id: "test",
        name_encrypted: "encrypted-name",
      }));
      await db.query(
        "insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values ($1,$2,$3,'uploaded',$4::jsonb)",
        [id, owner, root.repeat(64), JSON.stringify(items)],
      );
      for (const [i, item] of items.entries())
        if (!missingLast || i < items.length - 1)
          await db.query(
            "insert into storage.objects(bucket_id,name) values ('document-evidence',$1)",
            [item.path],
          );
      await db.exec("set role service_role");
      return id;
    }
    async function register(attempt: string, year = 2025) {
      return (
        await db.query<{
          result: { batch_id: string; created: boolean; files: number };
        }>(
          "select register_document_intake($1,$2,$3,'invoice','opaque-evidence/1') result",
          [owner, attempt, year],
        )
      ).rows[0].result;
    }
    const first = await register(await makeAttempt("a", ["b", "b"]));
    assert.equal(first.created, true);
    assert.equal(first.files, 3);
    assert.equal(
      (await db.query("select * from evidence_documents")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from document_batch_items")).rows.length,
      3,
    );
    const repeat = await register(await makeAttempt("a", ["b", "b"]));
    assert.equal(repeat.created, false);
    assert.equal(repeat.batch_id, first.batch_id);
    assert.equal(
      (await db.query("select * from document_batches")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from document_intake_events")).rows.length,
      2,
    );
    const failed = await makeAttempt("c", ["d"], true);
    await assert.rejects(register(failed), /object missing/);
    assert.equal(
      (await db.query("select * from evidence_documents")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from document_batches")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from financial_records")).rows.length,
      0,
    );
    const nextYear = await register(await makeAttempt("a", ["b", "b"]), 2026);
    assert.notEqual(nextYear.batch_id, first.batch_id);
    assert.equal(
      (await db.query("select * from evidence_documents")).rows.length,
      2,
    );
    await db.exec("reset role");
    await assert.rejects(
      db.query("update evidence_documents set file_hash=$1", ["e".repeat(64)]),
      /immutable/i,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select id,file_hash,size_bytes from evidence_documents"))
        .rows.length,
      2,
    );
    for (const sql of [
      "select object_path from evidence_documents",
      "select key_id from evidence_documents",
      "select original_name_encrypted from document_batch_items",
      "select * from document_upload_attempts",
      "insert into document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) select user_id,id,2025,'other','opaque-evidence/1' from evidence_documents limit 1",
      "delete from document_batch_items",
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await assert.rejects(register(failed), /permission denied/);
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='document-evidence'",
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select id from evidence_documents")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select id from document_batches")).rows.length,
      0,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query("select id from evidence_documents"),
      /permission denied/,
    );
    await assert.rejects(register(failed), /permission denied/);
  } finally {
    await db.close();
  }
});
