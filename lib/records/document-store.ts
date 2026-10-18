import { uploadEvidence } from "./evidence-upload";
import "server-only";
import { createAdminClient } from "../supabase/admin";
import { loadEvidenceKey } from "./evidence-key";
import {
  persistDocumentIntake,
  type DocumentRegistration,
} from "./document-persistence";
import {
  DOCUMENT_PARSER_VERSION,
  type IntakeFile,
  type DocumentPurpose,
} from "./document-intake";

/** Caller authenticates and fully validates the bounded upload before invoking this privileged path. */
export async function storeDocumentIntake(
  owner: string,
  files: IntakeFile[],
  year: number,
  purpose: DocumentPurpose,
) {
  const { key, keyId } = loadEvidenceKey();
  const admin = createAdminClient();
  if (!admin) throw new Error("Secure source storage is not configured.");
  let attemptId: string | undefined;
  return persistDocumentIntake(owner, files, year, purpose, key, keyId, {
    async createAttempt(attempt) {
      const { error } = await admin
        .from("document_upload_attempts")
        .insert(attempt);
      if (error) throw new Error("Could not prepare secure document storage.");
      attemptId = attempt.id;
    },
    async upload(path, cipher) {
      if (!attemptId) throw new Error("Document upload attempt is unavailable.");
      await uploadEvidence(admin, { owner, kind: "document", attempt: attemptId, path, bytes: cipher });
    },
    async transition(attempt, user, from, to) {
      const { data, error } = await admin
        .from("document_upload_attempts")
        .update({ state: to })
        .eq("id", attempt)
        .eq("user_id", user)
        .in("state", from)
        .select("id")
        .maybeSingle();
      if (error || !data)
        throw new Error("Could not register the uploaded evidence.");
    },
    async register(attempt, user, taxYear, documentPurpose) {
      const { data, error } = await admin.rpc("register_document_intake", {
        p_owner: user,
        p_attempt: attempt,
        p_year: taxYear,
        p_purpose: documentPurpose,
        p_parser: DOCUMENT_PARSER_VERSION,
      });
      if (error || !data)
        throw new Error("Could not register the complete document intake.");
      return data as DocumentRegistration;
    },
  });
}
