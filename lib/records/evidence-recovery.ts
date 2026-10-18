import { GROUPED_SOURCE_PARSER } from "./source-groups";
import type { EvidenceKeyring } from "./evidence-keyring";
import {
  decryptSource,
  encryptSource,
  sourceContext,
  sourceHash,
  documentContext,
  documentNameContext,
} from "./source-crypto";
import {
  prepareDocumentIntake,
  DOCUMENT_PARSER_VERSION,
  type DocumentPurpose,
} from "./document-intake";
import { SOURCE_PARSER_VERSION } from "./source-csv";
import {
  sourcePlan,
  prepareSourceRows,
  type SourceAttempt,
} from "./source-persistence";
import type { DocumentAttempt } from "./document-persistence";
export type RecoveryTransport = {
  read: (bucket: string, path: string) => Promise<Uint8Array | null>;
  upload: (bucket: string, path: string, bytes: Buffer) => Promise<void>;
};
export function stableEvidenceJson(value: unknown) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
export function verifiedBytes(
  cipher: Uint8Array | null,
  key: Uint8Array,
  context: string,
  hash: string,
  size: number,
) {
  if (!cipher)
    throw new Error(
      "The original evidence object is missing. Re-upload the exact original through import review.",
    );
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 3_000_000 ||
    cipher.length !== size + 29
  )
    throw new Error("Evidence size does not match its preserved manifest.");
  let bytes: Buffer;
  try {
    bytes = decryptSource(cipher, key, context);
  } catch {
    throw new Error(
      "Evidence authentication failed. Restore the recorded key or original ciphertext.",
    );
  }
  if (bytes.length !== size || sourceHash(bytes) !== hash)
    throw new Error("Evidence hash does not match its preserved manifest.");
  return bytes;
}
function identity(
  a: { id: string; user_id: string; file_hash: string },
  owner: string,
) {
  if (a.user_id !== owner || !/^[a-f0-9]{64}$/.test(a.file_hash))
    throw new Error("Owned evidence identity is unavailable.");
}
/** Decrypted original rows are used only inside the privileged server, never returned to the browser. */
export async function verifySourceRecovery(
  a: SourceAttempt,
  owner: string,
  keys: EvidenceKeyring,
  transport: RecoveryTransport,
) {
  identity(a, owner);
  const plan = a.recovery_plan;
  if (
    !plan ||
    plan.version !== 1 ||
    ![SOURCE_PARSER_VERSION, GROUPED_SOURCE_PARSER].includes(plan.parser) ||
    a.object_path !== `${owner}/${a.account_id}/${a.id}.enc` ||
    a.size_bytes > 1_000_000
  )
    throw new Error("This attempt needs a fresh field-mapping review.");
  const key = keys.key(a.key_id),
    bytes = verifiedBytes(
      await transport.read("source-evidence", a.object_path),
      key,
      sourceContext(owner, a.account_id, a.file_hash),
      a.file_hash,
      a.size_bytes,
    );
  const rebuilt = sourcePlan(bytes, plan.mapping, plan.filename);
  if (stableEvidenceJson(rebuilt.plan) !== stableEvidenceJson(plan))
    throw new Error(
      "Preserved source no longer agrees with its confirmed mapping.",
    );
  const rows = prepareSourceRows(
    owner,
    a.account_id,
    a.file_hash,
    plan.mapping,
    rebuilt.rows,
    key,
  );
  const manifest = sourceHash(
    Buffer.from(
      stableEvidenceJson({
        kind: "source",
        attempt_id: a.id,
        file_hash: a.file_hash,
        plan,
        rows: rows.map((r) => ({
          row_number: r.row_number,
          row_hash: r.row_hash,
          fingerprint: r.fingerprint,
        })),
      }),
    ),
  );
  return { rows, manifest };
}
export async function verifyDocumentRecovery(
  a: DocumentAttempt,
  owner: string,
  keys: EvidenceKeyring,
  transport: RecoveryTransport,
) {
  identity(a, owner);
  const plan = a.recovery_plan,
    objects = a.planned_objects;
  if (
    !plan ||
    plan.version !== 1 ||
    plan.parser !== DOCUMENT_PARSER_VERSION ||
    !Number.isInteger(plan.year) ||
    plan.year < 2000 ||
    plan.year > 2100 ||
    !["invoice", "receipt", "employment", "other"].includes(plan.purpose) ||
    !Array.isArray(objects) ||
    objects.length < 1 ||
    objects.length > 101 ||
    objects[0].hash !== a.file_hash
  )
    throw new Error("This attempt needs a fresh document-scope review.");
  for (const [i, o] of objects.entries())
    if (
      o.path !== `${owner}/${a.id}/${i}.enc` ||
      !/^[a-f0-9]{64}$/.test(o.hash)
    )
      throw new Error("Preserved document identity is inconsistent.");
  const root = objects[0],
    rootKey = keys.key(root.key_id),
    rootBytes = verifiedBytes(
      await transport.read("document-evidence", root.path),
      rootKey,
      documentContext(owner, root.hash),
      root.hash,
      root.size,
    );
  const names = objects.map((o, i) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        decryptSource(
          Buffer.from(o.name_encrypted, "base64"),
          keys.key(o.key_id),
          documentNameContext(owner, a.file_hash, i),
        ),
      );
    } catch {
      throw new Error(
        "The recorded document name key or encrypted name is unavailable.",
      );
    }
  });
  const files = await prepareDocumentIntake(
    names[0],
    rootBytes,
    plan.purpose as DocumentPurpose,
  );
  if (files.length !== objects.length)
    throw new Error("Recovered document membership changed.");
  for (const [i, file] of files.entries()) {
    const o = objects[i];
    if (
      file.name !== names[i] ||
      file.mediaType !== o.media_type ||
      file.bytes.length !== o.size ||
      sourceHash(file.bytes) !== o.hash
    )
      throw new Error(
        "Recovered document does not match its original manifest.",
      );
  }
  // Verify complete membership first. Missing children can be regenerated from the
  // verified original ZIP. Existing ciphertext is never overwritten, even if corrupt.
  for (const [i, o] of objects.entries()) {
    const key = keys.key(o.key_id),
      context = documentContext(owner, o.hash);
    let cipher =
      i === 0 ? null : await transport.read("document-evidence", o.path);
    if (i === 0) continue;
    if (!cipher) {
      try {
        await transport.upload(
          "document-evidence",
          o.path,
          encryptSource(files[i].bytes, key, context),
        );
      } catch {
        /* Ambiguous upload response: read back and authenticate before continuing. */
      }
      cipher = await transport.read("document-evidence", o.path);
    }
    verifiedBytes(cipher, key, context, o.hash, o.size);
  }
  const manifest = sourceHash(
    Buffer.from(
      stableEvidenceJson({
        kind: "document",
        attempt_id: a.id,
        root_hash: a.file_hash,
        plan,
        objects: objects.map((o, i) => ({
          ordinal: i,
          hash: o.hash,
          size: o.size,
          media_type: o.media_type,
          key_id: o.key_id,
          name_sha256: sourceHash(Buffer.from(names[i])),
        })),
      }),
    ),
  );
  return { rows: null, manifest };
}
