import { uploadEvidence } from "./evidence-upload";
import "server-only";
import { createAdminClient } from "../supabase/admin";
import { loadEvidenceKey } from "./evidence-key";
import {
  persistSourceCsv,
  type SourceRegistration,
  type SourceAttempt,
  type PreparedSourceRow,
} from "./source-persistence";
import { persistDimensionedSourceCsv, type DimensionedSourceAttempt, type PreparedDimensionedSourceRow } from './source-persistence-v2';
import type { CsvMapping } from "./source-csv";
/** Caller authenticates and verifies account ownership before this privileged path. */
export async function storeSourceCsv(input: {
  owner: string;
  account: string;
  bytes: Uint8Array;
  filename: string;
  mapping: CsvMapping;
  accountCurrency?: string;
}) {
  const { key, keyId } = loadEvidenceKey(),
    admin = createAdminClient();
  if (!admin) throw new Error("Secure source storage is not configured.");
  let attemptId: string | undefined;
  const transport = {
    async createAttempt(attempt: SourceAttempt | DimensionedSourceAttempt) {
      const { error } = await admin
        .from("source_upload_attempts")
        .insert<SourceAttempt | DimensionedSourceAttempt>(attempt);
      if (error) throw new Error("Could not prepare secure source storage.");
      attemptId = attempt.id;
    },
    async upload(path: string, cipher: Buffer) {
      if (!attemptId) throw new Error("Source upload attempt is unavailable.");
      await uploadEvidence(admin, { owner: input.owner, kind: "source", attempt: attemptId, path, bytes: cipher });
    },
    async transition(id: string, owner: string, from: string[], to: string) {
      const { data, error } = await admin
        .from("source_upload_attempts")
        .update({ state: to })
        .eq("id", id)
        .eq("user_id", owner)
        .in("state", from)
        .select("id")
        .maybeSingle();
      if (error || !data)
        throw new Error("Source upload state changed or could not be saved.");
    },
    async register(a: SourceAttempt | DimensionedSourceAttempt, rows: PreparedSourceRow[] | PreparedDimensionedSourceRow[]) {
      const { data, error } = await admin.rpc("ingest_source_csv", {
        p_owner: a.user_id,
        p_attempt: a.id,
        p_filename: a.recovery_plan.filename,
        p_parser: a.recovery_plan.parser,
        p_mapping: a.recovery_plan.mapping,
        p_rows: rows,
      });
      if (error || !data?.import_id)
        throw new Error(
          "Could not stage source transactions. The retained attempt can be recovered after verification.",
        );
      return data as SourceRegistration;
    },
  };
  return input.accountCurrency !== undefined && input.accountCurrency !== 'GBP'
    ? persistDimensionedSourceCsv({...input, accountCurrency:input.accountCurrency},key,keyId,transport)
    : persistSourceCsv(input,key,keyId,transport);
}
