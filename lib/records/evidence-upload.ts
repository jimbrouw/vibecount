import { randomUUID } from "node:crypto";

/** Narrow Supabase surface keeps the durable-operation protocol independently testable. */
export type EvidenceUploadClient = {
  rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from(bucket: string): {
      upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: unknown }>;
    };
  };
};

/** An uncertain response deliberately leaves the operation unresolved. Never retry the provider here. */
export async function uploadEvidence(
  admin: EvidenceUploadClient,
  input: { owner: string; kind: "source" | "document"; attempt: string; path: string; bytes: Uint8Array },
): Promise<void> {
  const operation = randomUUID();
  const begun = await admin.rpc("begin_evidence_upload", {
    p_owner: input.owner,
    p_kind: input.kind,
    p_attempt: input.attempt,
    p_path: input.path,
    p_operation: operation,
  });
  if (begun.error || begun.data !== true)
    throw new Error("Could not authorize evidence upload. Reload the evidence state before retrying.");

  const uploaded = await admin.storage.from(`${input.kind}-evidence`).upload(input.path, input.bytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error)
    throw new Error("Could not confirm encrypted evidence upload. The upload operation remains unresolved.");

  const completed = await admin.rpc("completed_evidence_upload", {
    p_owner: input.owner,
    p_operation: operation,
  });
  if (completed.error || completed.data !== true)
    throw new Error("Could not record evidence upload completion. The upload operation remains unresolved.");
}
