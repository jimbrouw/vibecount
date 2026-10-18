import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  persistDocumentIntake,
  type DocumentAttempt,
  type DocumentAttemptState,
  type DocumentTransport,
} from "./document-persistence.ts";
import {
  decryptSource,
  documentContext,
  documentNameContext,
} from "./source-crypto.ts";

const files = [
  "private-invoices.zip",
  "Private invoice 1.pdf",
  "Private invoice 2.pdf",
].map((name, i) => ({
  name,
  mediaType: i ? "application/pdf" : "application/zip",
  bytes: Buffer.from(`synthetic file ${i}`),
}));
const key = randomBytes(32);
function mock(
  fail: "create" | "upload" | "state" | "register" | "lost-response" | "none",
) {
  let attempt: DocumentAttempt | null = null;
  let state: DocumentAttemptState = "pending";
  const stored = new Map<string, Buffer>();
  let registrations = 0;
  const transport: DocumentTransport = {
    async createAttempt(value) {
      if (fail === "create") throw new Error("create failed");
      attempt = value;
    },
    async upload(path, bytes) {
      if (fail === "upload" && stored.size === 1)
        throw new Error("upload failed");
      stored.set(path, bytes);
    },
    async transition(id, owner, from, to) {
      assert.equal(id, attempt?.id);
      assert.equal(owner, "owner");
      if (fail === "state" && to === "uploaded")
        throw new Error("state failed");
      if (from.includes(state)) state = to;
    },
    async register() {
      registrations++;
      if (fail === "register") throw new Error("register failed");
      state = "linked";
      if (fail === "lost-response")
        throw new Error("response lost after commit");
      return { batch_id: "batch", created: true, files: 3 };
    },
  };
  return {
    transport,
    get attempt() {
      return attempt;
    },
    get state() {
      return state;
    },
    stored,
    get registrations() {
      return registrations;
    },
  };
}

test("document persistence encrypts exact originals/names and registers only after all uploads", async () => {
  const adapter = mock("none");
  const result = await persistDocumentIntake(
    "owner",
    files,
    2025,
    "invoice",
    key,
    "test-key",
    adapter.transport,
  );
  assert.equal(result.files, 3);
  assert.equal(adapter.state, "linked");
  const attempt = adapter.attempt!;
  assert.equal(JSON.stringify(attempt).includes("Private invoice"), false);
  assert.equal(attempt.planned_objects.length, 3);
  for (const [i, item] of attempt.planned_objects.entries()) {
    assert.deepEqual(
      decryptSource(
        adapter.stored.get(item.path)!,
        key,
        documentContext("owner", item.hash),
      ),
      files[i].bytes,
    );
    assert.equal(
      decryptSource(
        Buffer.from(item.name_encrypted, "base64"),
        key,
        documentNameContext("owner", attempt.file_hash, i),
      ).toString(),
      files[i].name,
    );
  }
});

test("partial upload, state and registration failures retain recoverable paths without registering partial evidence", async () => {
  for (const stage of ["create", "upload", "state", "register"] as const) {
    const adapter = mock(stage);
    await assert.rejects(
      persistDocumentIntake(
        "owner",
        files,
        2025,
        "invoice",
        key,
        "test-key",
        adapter.transport,
      ),
    );
    if (stage === "create") {
      assert.equal(adapter.stored.size, 0);
      assert.equal(adapter.registrations, 0);
      continue;
    }
    assert.equal(adapter.attempt!.planned_objects.length, 3);
    assert.equal(adapter.state, "failed");
    assert.equal(adapter.stored.size, stage === "upload" ? 1 : 3);
    assert.equal(adapter.registrations, stage === "register" ? 1 : 0);
  }
});

test("lost response after committed registration preserves linked state and every uploaded object", async () => {
  const adapter = mock("lost-response");
  await assert.rejects(
    persistDocumentIntake(
      "owner",
      files,
      2025,
      "invoice",
      key,
      "test-key",
      adapter.transport,
    ),
    /response lost/,
  );
  assert.equal(adapter.state, "linked");
  assert.equal(adapter.stored.size, 3);
});
