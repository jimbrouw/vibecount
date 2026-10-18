import assert from "node:assert/strict";
import test from "node:test";
import { uploadEvidence, type EvidenceUploadClient } from "./evidence-upload";

const input = { owner: "owner", kind: "document" as const, attempt: "attempt", path: "owner/attempt/0.enc", bytes: new Uint8Array([1, 2, 3]) };
function fixture(options: { begin?: unknown; beginError?: boolean; beginThrows?: boolean; uploadError?: boolean; uploadThrows?: boolean; complete?: unknown; completeError?: boolean; completeThrows?: boolean } = {}) {
  const calls: { name: string; args?: Record<string, string> }[] = [];
  const client: EvidenceUploadClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "begin_evidence_upload") {
        if (options.beginThrows) throw new Error("lost begin response");
        return { data: "begin" in options ? options.begin : true, error: options.beginError ? new Error("begin denied") : null };
      }
      assert.equal(name, "completed_evidence_upload");
      if (options.completeThrows) throw new Error("lost completion response");
      return { data: "complete" in options ? options.complete : true, error: options.completeError ? new Error("completion failed") : null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, `${input.kind}-evidence`);
        return {
          async upload(path, bytes, uploadOptions) {
            calls.push({ name: "upload" });
            assert.equal(path, input.path);
            assert.equal(bytes, input.bytes);
            assert.deepEqual(uploadOptions, { contentType: "application/octet-stream", upsert: false });
            if (options.uploadThrows) throw new Error("lost upload response");
            return { error: options.uploadError ? new Error("upload failed") : null };
          },
        };
      },
    },
  };
  return { client, calls };
}

test("durably begins before upload and completes the same operation only after acknowledgement", async () => {
  const { client, calls } = fixture();
  await uploadEvidence(client, input);
  assert.deepEqual(calls.map(c => c.name), ["begin_evidence_upload", "upload", "completed_evidence_upload"]);
  const operation = calls[0].args!.p_operation;
  assert.match(operation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(calls[0].args, { p_owner: input.owner, p_kind: input.kind, p_attempt: input.attempt, p_path: input.path, p_operation: operation });
  assert.deepEqual(calls[2].args, { p_owner: input.owner, p_operation: operation });
});

for (const options of [{ begin: false }, { begin: null }, { begin: undefined }, { begin: "true" }, { beginError: true }, { beginThrows: true }]) {
  test(`unconfirmed begin never invokes Storage: ${JSON.stringify(options)}`, async () => {
    const { client, calls } = fixture(options);
    await assert.rejects(uploadEvidence(client, input));
    assert.deepEqual(calls.map(c => c.name), ["begin_evidence_upload"]);
  });
}
for (const options of [{ uploadError: true }, { uploadThrows: true }]) {
  test(`failed or uncertain upload stays unresolved: ${JSON.stringify(options)}`, async () => {
    const { client, calls } = fixture(options);
    await assert.rejects(uploadEvidence(client, input));
    assert.deepEqual(calls.map(c => c.name), ["begin_evidence_upload", "upload"]);
  });
}
for (const options of [{ complete: false }, { complete: null }, { completeError: true }, { completeThrows: true }]) {
  test(`failed completion never retries Storage: ${JSON.stringify(options)}`, async () => {
    const { client, calls } = fixture(options);
    await assert.rejects(uploadEvidence(client, input));
    assert.deepEqual(calls.map(c => c.name), ["begin_evidence_upload", "upload", "completed_evidence_upload"]);
  });
}
