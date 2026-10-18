import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, crc32 } from "node:zlib";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  prepareDocumentIntake,
  validateEvidencePath,
  readDocumentBody,
  MAX_DOCUMENT_BODY_BYTES,
} from "./document-intake.ts";
import {
  encryptSource,
  decryptSource,
  sourceHash,
  documentContext,
  documentNameContext,
} from "./source-crypto.ts";

const pdf = Buffer.from("%PDF-1.4\nSynthetic evidence, no user data.\n%%EOF\n");

test("committed synthetic invoice ZIP and employment PDF pass document intake", async () => {
  const archive = await readFile(
    new URL(
      "../../fixtures/document-evidence/synthetic-invoices.zip",
      import.meta.url,
    ),
  );
  const employment = await readFile(
    new URL("../../fixtures/document-evidence/employment.pdf", import.meta.url),
  );
  const invoices = await prepareDocumentIntake(
    "synthetic-invoices.zip",
    archive,
    "invoice",
  );
  assert.equal(invoices.length, 3);
  assert.deepEqual(
    invoices[1].bytes,
    await readFile(
      new URL(
        "../../fixtures/document-evidence/invoice-one.pdf",
        import.meta.url,
      ),
    ),
  );
  assert.equal(
    (await prepareDocumentIntake("employment.pdf", employment, "employment"))
      .length,
    1,
  );
});
type Member = {
  name: string;
  bytes?: Buffer;
  flags?: number;
  mode?: number;
  declaredSize?: number;
  checksum?: number;
};
function zip(members: Member[]) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name),
      bytes = member.bytes ?? pdf,
      compressed = deflateRawSync(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(member.flags ?? 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(member.checksum ?? crc32(bytes), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(member.declaredSize ?? bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(member.flags ?? 0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(member.checksum ?? crc32(bytes), 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(member.declaredSize ?? bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((member.mode ?? 0x81a4) * 65536) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("individual documents and invoice archives preserve exact bytes and repeated member occurrences", async () => {
  const files = await prepareDocumentIntake("p45.pdf", pdf, "employment");
  assert.deepEqual(files, [
    { name: "p45.pdf", bytes: pdf, mediaType: "application/pdf" },
  ]);
  const archive = zip([
    { name: "invoices/one.pdf" },
    { name: "invoices/two.pdf" },
  ]);
  const result = await prepareDocumentIntake(
    "invoices.zip",
    archive,
    "invoice",
  );
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].bytes, archive);
  assert.deepEqual(result[1].bytes, result[2].bytes);
  assert.notEqual(result[1].name, result[2].name);
  await assert.rejects(prepareDocumentIntake("p45.zip", archive, "employment"));
});

test("ZIP paths, links, encryption, collisions and non-PDF members reject the whole intake", async () => {
  for (const path of [
    "../one.pdf",
    "folder/../one.pdf",
    "/one.pdf",
    "C:/one.pdf",
    "folder\\one.pdf",
    "folder//one.pdf",
    "one\u0000.pdf",
    "./one.pdf",
  ])
    assert.throws(() => validateEvidencePath(path));
  for (const members of [
    [{ name: "../one.pdf" }],
    [{ name: "one.pdf", mode: 0xa1ff }],
    [{ name: "one.pdf", flags: 1 }],
    [{ name: "One.pdf" }, { name: "one.pdf" }],
    [{ name: "nested.zip" }],
    [{ name: "notes.txt" }],
    [{ name: "fake.pdf", bytes: Buffer.from("not a PDF") }],
  ])
    await assert.rejects(
      prepareDocumentIntake("bad.zip", zip(members), "invoice"),
    );
  await assert.rejects(
    prepareDocumentIntake(
      "fake.pdf",
      Buffer.from("<script>bad</script>"),
      "receipt",
    ),
  );
});

test("damaged, oversized and over-expanded ZIP entries reject without returning a partial batch", async () => {
  for (const members of [
    [{ name: "bad.pdf", checksum: 0 }],
    [{ name: "bad.pdf", declaredSize: pdf.length - 1 }],
    Array.from({ length: 101 }, (_, i) => ({ name: `${i}.pdf` })),
    [{ name: "large.pdf", bytes: Buffer.alloc(3_000_001) }],
    [{ name: "bomb.pdf", bytes: Buffer.concat([pdf, Buffer.alloc(900_000)]) }],
  ])
    await assert.rejects(
      prepareDocumentIntake("bad.zip", zip(members), "invoice"),
    );
  const payload = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    randomBytes(500_000),
    Buffer.alloc(2_100_000),
    Buffer.from("\n%%EOF"),
  ]);
  await assert.rejects(
    prepareDocumentIntake(
      "total.zip",
      zip(
        Array.from({ length: 4 }, (_, i) => ({
          name: `${i}.pdf`,
          bytes: payload,
        })),
      ),
      "invoice",
    ),
    /expansion/,
  );
  const truncated = zip([{ name: "valid.pdf" }]).subarray(0, -6);
  await assert.rejects(
    prepareDocumentIntake("truncated.zip", truncated, "invoice"),
  );
});

test("document bodies are bounded independently of declared Content-Length", async () => {
  const small = new Request("https://example.invalid", {
    method: "POST",
    body: "evidence",
  });
  assert.equal(
    Buffer.from(await readDocumentBody(small)).toString(),
    "evidence",
  );
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_DOCUMENT_BODY_BYTES + 1));
      controller.close();
    },
  });
  const request = new Request("https://example.invalid", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readDocumentBody(request), /limit/);
});

test("document encryption binds content owner/hash and original-name archive ordinal", () => {
  const key = randomBytes(32),
    hash = sourceHash(pdf);
  const cipher = encryptSource(pdf, key, documentContext("owner", hash));
  assert.deepEqual(
    decryptSource(cipher, key, documentContext("owner", hash)),
    pdf,
  );
  assert.throws(() =>
    decryptSource(cipher, key, documentContext("other", hash)),
  );
  assert.throws(() =>
    decryptSource(cipher, key, documentContext("owner", "wrong")),
  );
  const name = encryptSource(
    Buffer.from("Private P45 name.pdf"),
    key,
    documentNameContext("owner", hash, 1),
  );
  assert.throws(() =>
    decryptSource(name, key, documentNameContext("owner", hash, 2)),
  );
  assert.throws(() => decryptSource(name, key, documentContext("owner", hash)));
});
