import { fromBufferPromise } from "yauzl";
import { crc32 } from "node:zlib";

export const MAX_DOCUMENT_BYTES = 3_000_000;
export const MAX_DOCUMENT_BODY_BYTES = 3_100_000;
export const MAX_ARCHIVE_ENTRIES = 100;
export const MAX_EXPANDED_BYTES = 10_000_000;
export const DOCUMENT_PARSER_VERSION = "opaque-evidence/1";
export const DOCUMENT_PURPOSES = [
  "invoice",
  "receipt",
  "employment",
  "other",
] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];
export type IntakeFile = { name: string; bytes: Buffer; mediaType: string };

/** Bounded before multipart parsing, including when Content-Length is missing or false. */
export async function readDocumentBody(
  request: Request,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > MAX_DOCUMENT_BODY_BYTES)
    throw new Error("Upload exceeds the request limit.");
  if (!request.body) throw new Error("Choose a document.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_BODY_BYTES)
        throw new Error("Upload exceeds the request limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function validateEvidencePath(name: string): string {
  const normalized = name.normalize("NFC");
  const parts = normalized.replace(/\/$/, "").split("/");
  if (
    !name ||
    name.length > 240 ||
    /[\\\x00-\x1f\x7f:]/.test(name) ||
    name.startsWith("/") ||
    parts.some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Archive has an unsafe or ambiguous member path.");
  return normalized;
}

/** Signature checks only: opaque evidence is never executed, rendered or treated as extracted facts. */
function mediaType(name: string, bytes: Buffer): string {
  if (bytes.length < 1 || bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("Each document must be between 1 byte and 3 MB.");
  if (
    /\.pdf$/i.test(name) &&
    /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii")) &&
    bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    return "application/pdf";
  if (
    /\.png$/i.test(name) &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    /\.jpe?g$/i.test(name) &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return "image/jpeg";
  throw new Error("Choose a PDF, PNG or JPEG with a matching file signature.");
}

/** All members validate before anything is persisted. No extraction to disk. */
export async function prepareDocumentIntake(
  name: string,
  bytes: Buffer,
  purpose: DocumentPurpose,
): Promise<IntakeFile[]> {
  if (!DOCUMENT_PURPOSES.includes(purpose))
    throw new Error("Choose a document purpose.");
  if (!name || /[\x00-\x1f\x7f]/.test(name) || name.length > 240)
    throw new Error("Choose a valid document name.");
  if (bytes.length < 1 || bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("Upload a file up to 3 MB.");
  if (!/\.zip$/i.test(name))
    return [{ name, bytes, mediaType: mediaType(name, bytes) }];
  if (purpose !== "invoice")
    throw new Error(
      "ZIP intake is for invoice PDF archives. Upload other evidence individually.",
    );
  const zip = await fromBufferPromise(bytes, {
    validateEntrySizes: true,
    strictFileNames: true,
    decodeStrings: true,
  });
  const files: IntakeFile[] = [{ name, bytes, mediaType: "application/zip" }];
  let entries = 0;
  let expanded = 0;
  const names = new Set<string>();
  try {
    if (zip.entryCount > MAX_ARCHIVE_ENTRIES)
      throw new Error("Archive contains too many entries.");
    for await (const entry of zip.eachEntry()) {
      if (++entries > MAX_ARCHIVE_ENTRIES)
        throw new Error("Archive contains too many entries.");
      const path = validateEvidencePath(entry.fileName);
      const identity = path.replace(/\/$/, "").toLowerCase();
      if (names.has(identity))
        throw new Error("Archive contains duplicate member paths.");
      names.add(identity);
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      const directory = path.endsWith("/");
      if (
        (entry.generalPurposeBitFlag & 1) !== 0 ||
        ![0, 8].includes(entry.compressionMethod) ||
        (mode !== 0 && mode !== (directory ? 0x4000 : 0x8000))
      )
        throw new Error(
          "Archive contains encrypted, linked or unsupported members.",
        );
      if (directory) {
        if (entry.uncompressedSize !== 0)
          throw new Error("Invalid directory member.");
        continue;
      }
      if (!/\.pdf$/i.test(path))
        throw new Error(
          "Every archive member must be an invoice PDF; remove other files before uploading.",
        );
      if (
        entry.uncompressedSize < 1 ||
        entry.uncompressedSize > MAX_DOCUMENT_BYTES ||
        expanded + entry.uncompressedSize > MAX_EXPANDED_BYTES ||
        entry.uncompressedSize > Math.max(entry.compressedSize, 1) * 100
      )
        throw new Error("Archive exceeds safe expansion limits.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let actual = 0;
      let checksum = 0;
      try {
        for await (const chunk of stream) {
          const part = Buffer.from(chunk);
          actual += part.length;
          expanded += part.length;
          if (
            actual > MAX_DOCUMENT_BYTES ||
            expanded > MAX_EXPANDED_BYTES ||
            actual > entry.uncompressedSize
          )
            throw new Error("Archive exceeds safe expansion limits.");
          checksum = crc32(part, checksum);
          chunks.push(part);
        }
      } finally {
        stream.destroy();
      }
      if (actual !== entry.uncompressedSize || checksum !== entry.crc32)
        throw new Error("Archive member integrity check failed.");
      const content = Buffer.concat(chunks);
      files.push({
        name: path,
        bytes: content,
        mediaType: mediaType(path, content),
      });
    }
    if (files.length === 1)
      throw new Error("Archive contains no invoice PDFs.");
    return files;
  } finally {
    zip.close();
  }
}
