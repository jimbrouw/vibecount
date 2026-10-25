import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

test("POST /api/mcp returns 401 Unauthorized when Authorization header is absent", async () => {
  const req = new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("Missing Bearer token"));
});

test("POST /api/mcp returns 500 or 401 when service credentials or token are invalid", async () => {
  const req = new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer vc_live_invalidtoken123",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });

  const res = await POST(req);
  // Without configured Supabase service keys in unit test runner, returns 500; with keys, returns 401
  assert.ok([401, 500].includes(res.status), `Expected 401 or 500, got ${res.status}`);
});
