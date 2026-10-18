import { isMissingEvidenceObject } from "./evidence-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEvidenceKeyring } from "./evidence-keyring.ts";
import {
  persistSourceCsv,
  type SourceAttempt,
  type SourceTransport,
} from "./source-persistence.ts";
import {
  persistDocumentIntake,
  type DocumentAttempt,
  type DocumentAttemptState,
  type DocumentTransport,
} from "./document-persistence.ts";
import {
  verifySourceRecovery,
  verifyDocumentRecovery,
  type RecoveryTransport,
} from "./evidence-recovery.ts";
import { readSourceCsv, suggestMapping } from "./source-csv.ts";
import { prepareDocumentIntake } from "./document-intake.ts";
import { decryptSource, sourceContext } from "./source-crypto.ts";
const owner = randomUUID(),
  account = randomUUID(),
  oldKey = randomBytes(32),
  newKey = randomBytes(32);
const keys = () =>
  parseEvidenceKeyring({
    VIBECOUNT_SOURCE_KEY_ID: "new",
    VIBECOUNT_SOURCE_ENCRYPTION_KEYS: JSON.stringify([
      { id: "old", key: oldKey.toString("base64") },
      { id: "new", key: newKey.toString("base64") },
    ]),
  });

test("evidence keyring rotates writes while retaining exact historic decryption keys and fails closed", () => {
  const legacy = parseEvidenceKeyring({
    VIBECOUNT_SOURCE_ENCRYPTION_KEY: oldKey.toString("base64"),
  });
  assert.equal(legacy.activeId, "v1");
  assert.deepEqual(legacy.key("v1"), oldKey);
  assert.deepEqual(keys().key("old"), oldKey);
  assert.deepEqual(keys().key(keys().activeId), newKey);
  assert.throws(() => keys().key("missing"), /unavailable/);
  for (const values of [
    [],
    [{ id: "old", key: "SENSITIVE INVALID KEY" }],
    [
      { id: "old", key: oldKey.toString("base64") },
      { id: "old", key: newKey.toString("base64") },
    ],
    [{ id: "bad id", key: oldKey.toString("base64") }],
  ])
    assert.throws(
      () =>
        parseEvidenceKeyring({
          VIBECOUNT_SOURCE_KEY_ID: "old",
          VIBECOUNT_SOURCE_ENCRYPTION_KEYS: JSON.stringify(values),
        }),
      (e) => e instanceof Error && !e.message.includes("SENSITIVE"),
    );
  assert.throws(
    () =>
      parseEvidenceKeyring({
        VIBECOUNT_SOURCE_KEY_ID: "new",
        VIBECOUNT_SOURCE_ENCRYPTION_KEYS: JSON.stringify([
          { id: "old", key: oldKey.toString("base64") },
        ]),
      }),
    /active evidence key/,
  );
  assert.throws(
    () =>
      parseEvidenceKeyring({
        VIBECOUNT_SOURCE_ENCRYPTION_KEY: oldKey.toString("base64"),
        VIBECOUNT_SOURCE_ENCRYPTION_KEYS: "[]",
        VIBECOUNT_SOURCE_KEY_ID: "old",
      }),
    /one evidence key configuration/,
  );
  assert.throws(
    () =>
      parseEvidenceKeyring({
        VIBECOUNT_SOURCE_ENCRYPTION_KEYS: "not JSON",
        VIBECOUNT_SOURCE_KEY_ID: "old",
      }),
    /Invalid evidence keyring/,
  );
  const copy = keys().key("old");
  copy.fill(0);
  assert.deepEqual(keys().key("old"), oldKey);
});
async function sourceFixture(fail: string) {
  const bytes = await readFile(
      new URL("../../fixtures/synthetic-starling.csv", import.meta.url),
    ),
    mapping = suggestMapping(readSourceCsv(bytes.toString())[0], "starling");
  let attempt: SourceAttempt | null = null,
    state = "pending";
  const objects = new Map<string, Uint8Array>();
  const transport: SourceTransport = {
    async createAttempt(a) {
      attempt = a;
    },
    async upload(path, b) {
      if (fail === "before-upload") throw new Error("upload failed");
      objects.set(path, b);
      if (fail === "upload-response") throw new Error("response lost");
    },
    async transition(_id, _owner, from, to) {
      if (fail === "transition" && to === "uploaded")
        throw new Error("state unavailable");
      if (from.includes(state)) state = to;
      else throw new Error("state changed");
    },
    async register() {
      if (fail === "lost-commit") {
        state = "linked";
        throw new Error("response lost after commit");
      }
      throw new Error("registration failed");
    },
  };
  await assert.rejects(
    persistSourceCsv(
      { owner, account, bytes, filename: "synthetic-starling.csv", mapping },
      oldKey,
      "old",
      transport,
    ),
  );
  return {
    attempt: attempt!,
    objects,
    get state() {
      return state;
    },
    bytes,
  };
}
function recoveryTransport(
  objects: Map<string, Uint8Array>,
  ambiguous = false,
) {
  let writes = 0;
  const t: RecoveryTransport = {
    async read(_bucket, path) {
      return objects.get(path) ?? null;
    },
    async upload(_bucket, path, b) {
      writes++;
      if (objects.has(path)) throw new Error("No overwrite");
      objects.set(path, b);
      if (ambiguous) throw new Error("Lost response");
    },
  };
  return {
    transport: t,
    get writes() {
      return writes;
    },
  };
}
test("source failure recovery reuses confirmed mapping and original key; missing, tampered and wrongly scoped originals reject", async () => {
  for (const fail of [
    "before-upload",
    "upload-response",
    "transition",
    "register",
    "lost-commit",
  ]) {
    const f = await sourceFixture(fail);
    assert.equal(f.state, fail === "lost-commit" ? "linked" : "failed");
    assert.equal(f.attempt.recovery_plan.row_count, 8);
    const transport = recoveryTransport(f.objects);
    if (fail === "before-upload") {
      await assert.rejects(
        verifySourceRecovery(f.attempt, owner, keys(), transport.transport),
        /missing/,
      );
      continue;
    }
    const recovered = await verifySourceRecovery(
      f.attempt,
      owner,
      keys(),
      transport.transport,
    );
    assert.equal(recovered.rows.length, 8);
    assert.equal(recovered.manifest.length, 64);
    assert.equal(transport.writes, 0);
    const decoded = decryptSource(
      Buffer.from(recovered.rows[0].raw_encrypted, "base64"),
      oldKey,
      sourceContext(owner, account, f.attempt.file_hash, 2),
    );
    assert.deepEqual(
      JSON.parse(decoded.toString()),
      readSourceCsv(f.bytes.toString())[1],
    );
    assert.equal(
      (
        await verifySourceRecovery(
          f.attempt,
          owner,
          keys(),
          transport.transport,
        )
      ).manifest,
      recovered.manifest,
    );
    await assert.rejects(
      verifySourceRecovery(
        f.attempt,
        randomUUID(),
        keys(),
        transport.transport,
      ),
      /Owned evidence/,
    );
    await assert.rejects(
      verifySourceRecovery(
        {
          ...f.attempt,
          recovery_plan: { ...f.attempt.recovery_plan, row_count: 999 },
        },
        owner,
        keys(),
        transport.transport,
      ),
      /confirmed mapping/,
    );
    const damaged = Buffer.from(f.objects.get(f.attempt.object_path)!);
    damaged[damaged.length - 1] ^= 1;
    f.objects.set(f.attempt.object_path, damaged);
    await assert.rejects(
      verifySourceRecovery(f.attempt, owner, keys(), transport.transport),
      /authentication/,
    );
  }
});
test("partial ZIP recovery reconstructs only missing members from the verified root; ambiguous writes are authenticated", async () => {
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
  let state: DocumentAttemptState = "pending";
  const objects = new Map<string, Uint8Array>();
  let uploaded = 0;
  const transport: DocumentTransport = {
    async createAttempt(a) {
      attempt = a;
    },
    async upload(path, b) {
      if (uploaded++ === 1) throw new Error("partial upload");
      objects.set(path, b);
    },
    async transition(_a, _o, from, to) {
      if (from.includes(state)) state = to;
    },
    async register() {
      throw new Error("Must not register partial files");
    },
  };
  await assert.rejects(
    persistDocumentIntake(
      owner,
      files,
      2025,
      "invoice",
      oldKey,
      "old",
      transport,
    ),
    /partial/,
  );
  assert.equal(state, "failed");
  const recovering = recoveryTransport(objects, true),
    result = await verifyDocumentRecovery(
      attempt!,
      owner,
      keys(),
      recovering.transport,
    );
  assert.equal(recovering.writes, files.length - 1);
  assert.equal(objects.size, files.length);
  assert.equal(result.rows, null);
  assert.equal(result.manifest.length, 64);
  const noWrites = recoveryTransport(objects);
  assert.equal(
    (await verifyDocumentRecovery(attempt!, owner, keys(), noWrites.transport))
      .manifest,
    result.manifest,
  );
  assert.equal(noWrites.writes, 0);
  const a = attempt!;
  const child = a.planned_objects[1],
    corrupt = Buffer.from(objects.get(child.path)!);
  corrupt[corrupt.length - 1] ^= 1;
  objects.set(child.path, corrupt);
  await assert.rejects(
    verifyDocumentRecovery(a, owner, keys(), noWrites.transport),
    /authentication/,
  );
  assert.equal(noWrites.writes, 0);
  objects.delete(a.planned_objects[0].path);
  await assert.rejects(
    verifyDocumentRecovery(a, owner, keys(), noWrites.transport),
    /missing/,
  );
});

test("storage recovery distinguishes missing objects from permission, network and service errors", () => {
  for (const error of [
    { status: 404, statusCode: "NoSuchKey" },
    { status: 404, statusCode: "404" },
    { status: 400, statusCode: "ObjectNotFound" },
    { statusCode: "404" },
  ])
    assert.equal(isMissingEvidenceObject(error), true);
  for (const error of [
    { status: 401, statusCode: "NoSuchKey" },
    { status: 403, statusCode: "AccessDenied" },
    { status: 500, statusCode: "NoSuchKey" },
    { status: 404, statusCode: "BucketNotFound" },
    { status: 400, statusCode: "InvalidJWT" },
    new Error("network failed"),
    null,
  ])
    assert.equal(isMissingEvidenceObject(error), false);
});
