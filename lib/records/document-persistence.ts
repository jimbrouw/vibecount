import { randomUUID } from "node:crypto";
import {
  encryptSource,
  sourceHash,
  documentContext,
  documentNameContext,
} from "./source-crypto.ts";
import {
  DOCUMENT_PARSER_VERSION,
  type IntakeFile,
  type DocumentPurpose,
} from "./document-intake.ts";

export type DocumentAttempt = {
  id: string;
  user_id: string;
  file_hash: string;
  recovery_plan: {
    version: 1;
    year: number;
    purpose: DocumentPurpose;
    parser: string;
  };
  planned_objects: {
    hash: string;
    path: string;
    key_id: string;
    media_type: string;
    size: number;
    name_encrypted: string;
  }[];
};
export type DocumentRegistration = {
  batch_id: string;
  created: boolean;
  files: number;
};
export type DocumentAttemptState =
  | "pending"
  | "uploaded"
  | "linked"
  | "duplicate"
  | "failed";
export type DocumentTransport = {
  createAttempt: (attempt: DocumentAttempt) => Promise<void>;
  upload: (path: string, ciphertext: Buffer) => Promise<void>;
  transition: (
    attempt: string,
    owner: string,
    from: DocumentAttemptState[],
    to: DocumentAttemptState,
  ) => Promise<void>;
  register: (
    attempt: string,
    owner: string,
    year: number,
    purpose: DocumentPurpose,
  ) => Promise<DocumentRegistration>;
};

/** Transport is injected to exercise partial upload and uncertain-response recovery without production access. */
export async function persistDocumentIntake(
  owner: string,
  files: IntakeFile[],
  year: number,
  purpose: DocumentPurpose,
  key: Uint8Array,
  keyId: string,
  transport: DocumentTransport,
): Promise<DocumentRegistration> {
  const attempt = randomUUID();
  const rootHash = sourceHash(files[0].bytes);
  const objects = files.map((file, ordinal) => ({
    hash: sourceHash(file.bytes),
    path: `${owner}/${attempt}/${ordinal}.enc`,
    key_id: keyId,
    media_type: file.mediaType,
    size: file.bytes.length,
    name_encrypted: encryptSource(
      Buffer.from(file.name, "utf8"),
      key,
      documentNameContext(owner, rootHash, ordinal),
    ).toString("base64"),
  }));
  await transport.createAttempt({
    id: attempt,
    user_id: owner,
    file_hash: rootHash,
    recovery_plan: {
      version: 1,
      year,
      purpose,
      parser: DOCUMENT_PARSER_VERSION,
    },
    planned_objects: objects,
  });
  try {
    for (let i = 0; i < objects.length; i++)
      await transport.upload(
        objects[i].path,
        encryptSource(
          files[i].bytes,
          key,
          documentContext(owner, objects[i].hash),
        ),
      );
    await transport.transition(attempt, owner, ["pending"], "uploaded");
    return await transport.register(attempt, owner, year, purpose);
  } catch (error) {
    // The RPC may have committed before its response was lost. Retain all objects,
    // never downgrade linked/duplicate and preserve the original failure if recovery also fails.
    await transport
      .transition(attempt, owner, ["pending", "uploaded"], "failed")
      .catch(() => {});
    throw error;
  }
}
