import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptSource,
  decryptSource,
  sourceHash,
  sourceContext,
} from "./source-crypto.ts";

test("encrypted originals round-trip exact bytes and reject tampering, wrong owner/account/row or key", () => {
  const bytes = Buffer.from(
    "Date,Description,Amount\r\n01/02/2026,private account 12345678,-12.50\r\n",
  );
  const key = randomBytes(32);
  const hash = sourceHash(bytes);
  const context = sourceContext("owner", "account", hash);
  const a = encryptSource(bytes, key, context);
  const b = encryptSource(bytes, key, context);
  assert.notDeepEqual(a, b);
  assert.ok(!a.includes(Buffer.from("12345678")));
  const plain = decryptSource(a, key, context);
  assert.deepEqual(plain, bytes);
  assert.equal(sourceHash(plain), hash);
  const tampered = Buffer.from(a);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptSource(tampered, key, context));
  assert.throws(() => decryptSource(a, randomBytes(32), context));
  for (const ctx of [
    sourceContext("other", "account", hash),
    sourceContext("owner", "other", hash),
    sourceContext("owner", "account", hash, 2),
  ])
    assert.throws(() => decryptSource(a, key, ctx));
});
