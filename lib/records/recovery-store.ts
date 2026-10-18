import { uploadEvidence } from "./evidence-upload";
import { isMissingEvidenceObject } from "./evidence-storage";
import "server-only";
import { createAdminClient } from "../supabase/admin";
import { loadEvidenceKeyring } from "./evidence-key";
import {
  verifySourceRecovery,
  verifyDocumentRecovery,
  type RecoveryTransport,
} from "./evidence-recovery";
import type { SourceAttempt } from "./source-persistence";
import type { DocumentAttempt } from "./document-persistence";
import { verifyDimensionedSourceRecovery, type DimensionedSourceAttempt } from './source-persistence-v2';
export type RecoveryInput = {
  owner: string;
  kind: "source" | "document";
  attempt: string;
  stamp: string;
  request: string;
  reason: string;
};
/** Authenticated server action supplies owner; no raw evidence is returned to its caller. */
export async function recoverEvidenceAttempt(input: RecoveryInput) {
  const configured = createAdminClient();
  if (!configured)
    throw new Error("Secure evidence recovery is not configured.");
  const admin = configured;
  async function assertRetained() {
    const result = await admin.rpc('assert_evidence_attempt_retained', {
      p_owner: input.owner, p_kind: input.kind, p_attempt: input.attempt,
    });
    if (result.error || result.data !== true)
      throw new Error('Evidence recovery is unavailable. The source may be marked for deletion.');
  }
  async function replay() {
    await assertRetained();
    const { data: prior, error: priorError } = await admin
      .from("evidence_recovery_requests")
      .select(
        "kind,source_attempt_id,document_attempt_id,expected_stamp,reason,result",
      )
      .eq("user_id", input.owner)
      .eq("request_id", input.request)
      .maybeSingle();
    if (priorError)
      throw new Error("Could not verify earlier recovery requests.");
    if (prior) {
      if (
        prior.kind !== input.kind ||
        (prior.source_attempt_id ?? prior.document_attempt_id) !==
          input.attempt ||
        prior.expected_stamp !== input.stamp ||
        prior.reason !== input.reason
      )
        throw new Error("Recovery request was used for a different review.");
      return prior.result as Record<string, unknown>;
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  try {
    const current = await admin
      .from("evidence_recovery_attempts")
      .select("stamp")
      .eq("id", input.attempt)
      .eq("user_id", input.owner)
      .eq("kind", input.kind)
      .maybeSingle();
    if (current.error || current.data?.stamp !== input.stamp)
      throw new Error("Recovery scope changed. Reload before retrying.");
    const table =
      input.kind === "source"
        ? "source_upload_attempts"
        : "document_upload_attempts";
    const columns =
      input.kind === "source"
        ? "id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state,recovery_plan"
        : "id,user_id,file_hash,state,planned_objects,recovery_plan";
    const { data: attempt, error } = await admin
      .from(table)
      .select(columns)
      .eq("id", input.attempt)
      .eq("user_id", input.owner)
      .maybeSingle();
    if (error || !attempt)
      throw new Error("Owned upload attempt is unavailable.");
    const record = attempt as unknown as (SourceAttempt | DimensionedSourceAttempt | DocumentAttempt) & {
      state: string;
    };
    if (record.state !== "failed")
      throw new Error(
        "Only failed uploads can be retried. Reload the current evidence state.",
      );
    const transport: RecoveryTransport = {
      async read(bucket, path) {
        await assertRetained();
        const { data, error } = await admin.storage.from(bucket).download(path);
        if (error) {
          if (isMissingEvidenceObject(error)) return null;
          throw new Error("Could not read preserved evidence.");
        }
        if (!data || data.size > 3_000_029)
          throw new Error("Preserved evidence size is invalid.");
        return new Uint8Array(await data.arrayBuffer());
      },
      async upload(bucket, path, bytes) {
        await assertRetained();
        if (bucket !== `${input.kind}-evidence`)
          throw new Error("Recovery upload bucket does not match the evidence kind.");
        await uploadEvidence(admin, {
          owner: input.owner, kind: input.kind, attempt: input.attempt, path, bytes,
        });
      },
    };
    const keys = loadEvidenceKeyring();
    const verified =
      input.kind === "source"
        ? await (record.recovery_plan?.version === 2 ? verifyDimensionedSourceRecovery(
            record as DimensionedSourceAttempt, input.owner, keys, transport,
          ) : verifySourceRecovery(
            record as SourceAttempt,
            input.owner,
            keys,
            transport,
          ))
        : await verifyDocumentRecovery(
            record as DocumentAttempt,
            input.owner,
            keys,
            transport,
          );
    const { data: result, error: commitError } = await admin.rpc(
      "complete_evidence_recovery",
      {
        p_owner: input.owner,
        p_kind: input.kind,
        p_attempt: input.attempt,
        p_stamp: input.stamp,
        p_manifest: verified.manifest,
        p_rows: verified.rows,
        p_reason: input.reason,
        p_request: input.request,
      },
    );
    if (commitError || !result)
      throw new Error(
        "Recovery scope changed or registration could not complete. Reload the current attempt before retrying.",
      );
    return result as Record<string, unknown>;
  } catch (error) {
    // Another identical request may have committed between our first replay
    // lookup and a later state read or lost RPC response.
    const committed = await replay();
    if (committed) return committed;
    throw error;
  }
}
