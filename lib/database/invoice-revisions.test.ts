import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("invoice revisions preserve exact economics, legacy unknowns and immutable artifacts", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const name of migrations.filter((n) => n < "20261017150000"))
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  const owner = randomUUID(),
    other = randomUUID(),
    client = randomUUID(),
    foreignClient = randomUUID(),
    legacy = randomUUID();
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  await db.query(
    "insert into clients(id,user_id,name) values ($1,$2,'Synthetic client'),($3,$4,'Other client')",
    [client, owner, foreignClient, other],
  );
  await db.query(
    "insert into invoices(id,user_id,client_id,number,description,amount,status,pdf_path) values ($1,$2,$3,'LEGACY-1','Legacy evidence',120,'finalised',$4)",
    [legacy, owner, client, `${owner}/LEGACY-1.pdf`],
  );
  await db.exec(
    await readFile(
      new URL("20261017150000_invoice_revisions.sql", dir),
      "utf8",
    ),
  );
  async function asUser(id = owner) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function row(id = legacy) {
    return (
      await db.query<Record<string, unknown>>(
        "select * from invoices where id=$1",
        [id],
      )
    ).rows[0];
  }
  const base = {
    client_id: client,
    number: "LEGACY-1",
    invoice_date: "2026-04-05",
    due_date: "2026-05-05",
    description: "Reviewed invoice",
    payment_terms: "30 days",
    net_pence: 10000,
    vat_pence: 2000,
    vat_rate_bps: 2000,
    vat_enabled: true,
    vat_number: "GB-SYNTHETIC",
    reason: "Verified original evidence",
    pdf: { clientName: "Synthetic client" },
    legacy_confirmed: true,
  };
  async function upload(revision: string) {
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('invoices',$1)",
      [`${owner}/revisions/${revision}.pdf`],
    );
    await asUser();
  }
  async function save(
    id: string,
    revision: string,
    expected: unknown,
    data = base,
    path = `${owner}/revisions/${revision}.pdf`,
  ) {
    return (
      await db.query<{ result: Record<string, unknown> }>(
        "select save_invoice_revision($1,$2,$3,$4::jsonb,$5,$6) result",
        [id, revision, expected, JSON.stringify(data), path, "a".repeat(64)],
      )
    ).rows[0].result;
  }
  await asUser();
  const original = await row();
  await assert.rejects(
    db.query(
      "insert into invoices(user_id,client_id,number,description,amount,status) values ($1,$2,'BYPASS','Unreviewed direct insert',100,'finalised')",
      [owner, client],
    ),
    /reviewed invoice revision/,
  );

  await assert.rejects(
    db.query("update invoices set amount=144 where id=$1", [legacy]),
    /reviewed invoice revision/,
  );
  const baseline = (
    await db.query<{
      snapshot: { net_pence: null; amount: string };
      pdf_sha256: null;
    }>(
      "select snapshot,pdf_sha256 from invoice_revisions where invoice_id=$1",
      [legacy],
    )
  ).rows[0];
  assert.equal(baseline.snapshot.net_pence, null);
  assert.equal(Number(baseline.snapshot.amount), 120);
  assert.equal(baseline.pdf_sha256, null);
  const r1 = randomUUID();
  await upload(r1);
  await assert.rejects(
    save(legacy, r1, original.updated_at, {
      ...base,
      net_pence: 12000,
      vat_pence: 2400,
    }),
    /original invoice total/,
  );
  await assert.rejects(
    save(legacy, r1, original.updated_at, { ...base, vat_pence: -1 }),
    /Invalid invoice money/,
  );
  await assert.rejects(
    save(legacy, r1, original.updated_at, { ...base, vat_pence: 1 }),
    /Invalid invoice money/,
  );
  await assert.rejects(
    save(legacy, r1, original.updated_at, {
      ...base,
      client_id: foreignClient,
    }),
    /own client/,
  );
  const first = await save(legacy, r1, original.updated_at);
  assert.equal(first.version, 1);
  const saved = await row();
  await assert.rejects(
    db.query("update invoices set finalised_at=null where id=$1", [legacy]),
    /reviewed invoice revision/,
  );
  assert.equal(saved.amount, "120.00");
  assert.equal(Number(saved.net_pence), 10000);
  assert.equal(Number(saved.vat_pence), 2000);
  assert.deepEqual(await save(legacy, r1, original.updated_at), first);
  await assert.rejects(
    save(legacy, r1, original.updated_at, {
      ...base,
      reason: "Changed request",
    }),
    /request changed/,
  );
  const r2 = randomUUID();
  await upload(r2);
  await assert.rejects(
    save(legacy, r2, original.updated_at),
    /Invoice changed/,
  );
  await db.query(
    "update invoices set delivery_status='paid',paid_at='2026-04-06',sent_at='2026-04-05',reminder_enabled=false where id=$1",
    [legacy],
  );
  const before = await row();
  const second = await save(legacy, r2, before.updated_at, {
    ...base,
    description: "Revised description",
  });
  assert.equal(second.version, 2);
  const after = await row();
  for (const field of [
    "paid_at",
    "delivery_status",
    "sent_at",
    "reminder_enabled",
  ])
    assert.deepEqual(after[field], before[field]);
  assert.equal(
    (
      await db.query("select * from invoice_revisions where invoice_id=$1", [
        legacy,
      ])
    ).rows.length,
    3,
  );
  await assert.rejects(
    db.query("update invoices set pdf_path='replacement.pdf' where id=$1", [
      legacy,
    ]),
    /reviewed invoice revision/,
  );
  await assert.rejects(
    db.query("update invoices set net_pence=12000 where id=$1", [legacy]),
    /reviewed invoice revision/,
  );
  await assert.rejects(
    db.query("delete from invoice_revisions where id=$1", [r1]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("update invoice_revisions set pdf_sha256=$1 where id=$2", [
      "b".repeat(64),
      r1,
    ]),
    /permission denied/,
  );
  assert.equal(
    (
      await db.query(
        "update storage.objects set name=name where name=$1 returning id",
        [`${owner}/revisions/${r1}.pdf`],
      )
    ).rows.length,
    0,
  );
  const missing = randomUUID();
  await assert.rejects(
    save(legacy, missing, after.updated_at),
    /Preserve the reviewed PDF/,
  );
  assert.equal((await row()).economics_version, 2);
  await asUser(other);
  assert.equal(
    (await db.query("select * from invoice_revisions")).rows.length,
    0,
  );
  await assert.rejects(
    save(legacy, randomUUID(), after.updated_at),
    /Invoice not found/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    save(legacy, randomUUID(), after.updated_at),
    /permission denied/,
  );
  await asUser();
  const newId = randomUUID(),
    newRevision = randomUUID();
  await upload(newRevision);
  await save(newId, newRevision, null, {
    ...base,
    number: "NEW-1",
    net_pence: 12000,
    vat_pence: 0,
    vat_rate_bps: 0,
    vat_enabled: false,
    vat_number: "",
    reason: "Original invoice",
  });
  assert.equal((await row(newId)).amount, "120.00");
  await db.exec("reset role");
  const draft = randomUUID();
  await db.query(
    "insert into invoices(id,user_id,client_id,number,description,amount,status) values ($1,$2,$3,'DRAFT-VAT','Unfinalised template draft',100,'draft')",
    [draft, owner, client],
  );
  const draftRevision = randomUUID();
  await upload(draftRevision);
  const draftBefore = await row(draft);
  await assert.rejects(
    db.query("update invoices set finalised_at=now() where id=$1", [draft]),
    /reviewed invoice revision/,
  );
  await assert.rejects(
    db.query("update invoices set status='finalised' where id=$1", [draft]),
    /reviewed invoice revision/,
  );
  await save(draft, draftRevision, draftBefore.updated_at, {
    ...base,
    number: "DRAFT-VAT",
    legacy_confirmed: false,
  });
  assert.equal((await row(draft)).amount, "120.00");
  await db.exec("reset role");
  await assert.rejects(
    db.query("delete from invoice_revisions where id=$1", [r1]),
    /immutable/i,
  );
});
