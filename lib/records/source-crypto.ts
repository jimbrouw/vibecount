import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function sourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function documentContext(owner: string, hash: string): string {
  return JSON.stringify(["vibecount-document/v1", owner, hash]);
}
export function documentNameContext(
  owner: string,
  rootHash: string,
  ordinal: number,
): string {
  return JSON.stringify([
    "vibecount-document-name/v1",
    owner,
    rootHash,
    ordinal,
  ]);
}
export function sourceContext(
  owner: string,
  account: string,
  hash: string,
  row?: number,
): string {
  return JSON.stringify([
    "vibecount-source/v1",
    owner,
    account,
    hash,
    row ?? "file",
  ]);
}
export function encryptSource(
  bytes: Uint8Array,
  key: Uint8Array,
  context: string,
): Buffer {
  if (key.length !== 32)
    throw new Error("Source encryption requires a 32-byte key.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([
    Buffer.from([1]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export function decryptSource(
  envelope: Uint8Array,
  key: Uint8Array,
  context: string,
): Buffer {
  if (envelope.length < 29 || envelope[0] !== 1 || key.length !== 32)
    throw new Error("Invalid source envelope or key.");
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.slice(1, 13));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(envelope.slice(13, 29));
  return Buffer.concat([decipher.update(envelope.slice(29)), decipher.final()]);
}
