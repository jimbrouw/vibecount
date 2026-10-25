import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TOOLS, executeTool } from "./tools.ts";

test("MCP_TOOLS exports all expected agent tools with valid schemas", () => {
  const toolNames = MCP_TOOLS.map((t) => t.name);

  assert.ok(toolNames.includes("get_tax_year_summary"), "missing get_tax_year_summary");
  assert.ok(toolNames.includes("list_invoices"), "missing list_invoices");
  assert.ok(toolNames.includes("create_invoice_draft"), "missing create_invoice_draft");
  assert.ok(toolNames.includes("stage_spreadsheet_import"), "missing stage_spreadsheet_import");
  assert.ok(toolNames.includes("explain_tax_term"), "missing explain_tax_term");
  assert.ok(toolNames.includes("list_tax_terms"), "missing list_tax_terms");

  for (const tool of MCP_TOOLS) {
    assert.ok(tool.description.length > 10, `description too short for ${tool.name}`);
    assert.equal(tool.inputSchema.type, "object", `schema type must be object for ${tool.name}`);
  }
});

test("executeTool returns error message for unknown tool", async () => {
  const mockSupabase = {} as any;
  const result = await executeTool("non_existent_tool", {}, mockSupabase, "user-123");
  assert.equal(result, "Unknown tool: non_existent_tool");
});

test("create_invoice_draft rejects invalid inputs before touching database", async () => {
  const mockSupabase = {} as any;

  // Missing client
  const res1 = await executeTool(
    "create_invoice_draft",
    { client: "", amount: 500, description: "Design" },
    mockSupabase,
    "user-123"
  );
  assert.ok(res1.includes("Error: client name is required"));

  // Invalid / negative amount
  const res2 = await executeTool(
    "create_invoice_draft",
    { client: "Acme Corp", amount: -100, description: "Design" },
    mockSupabase,
    "user-123"
  );
  assert.ok(res2.includes("Error: valid positive amount is required"));

  // Missing description
  const res3 = await executeTool(
    "create_invoice_draft",
    { client: "Acme Corp", amount: 100, description: "" },
    mockSupabase,
    "user-123"
  );
  assert.ok(res3.includes("Error: description is required"));
});

test("stage_spreadsheet_import rejects invalid or malformed row data", async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        or: async () => ({ data: [], error: null }),
      }),
    }),
  } as any;

  // Empty records array
  const resEmpty = await executeTool(
    "stage_spreadsheet_import",
    { source_name: "Test Import", records: [] },
    mockSupabase,
    "user-123"
  );
  assert.ok(resEmpty.includes("Error: records array is empty"));

  // Malformed date
  const resBadDate = await executeTool(
    "stage_spreadsheet_import",
    {
      source_name: "Test Import",
      records: [{ date: "14/05/2026", description: "Lunch", amount: 15, type: "expense" }],
    },
    mockSupabase,
    "user-123"
  );
  assert.ok(resBadDate.includes("invalid date"));

  // Invalid type (not income or expense)
  const resBadType = await executeTool(
    "stage_spreadsheet_import",
    {
      source_name: "Test Import",
      records: [{ date: "2026-05-14", description: "Lunch", amount: 15, type: "transfer" }],
    },
    mockSupabase,
    "user-123"
  );
  assert.ok(resBadType.includes("type must be either 'income' or 'expense'"));

  // Non-positive amount
  const resBadAmount = await executeTool(
    "stage_spreadsheet_import",
    {
      source_name: "Test Import",
      records: [{ date: "2026-05-14", description: "Lunch", amount: 0, type: "expense" }],
    },
    mockSupabase,
    "user-123"
  );
  assert.ok(resBadAmount.includes("amount must be a positive number"));
});

test("explain_tax_term requires a non-empty term", async () => {
  const mockSupabase = {} as any;
  const res = await executeTool("explain_tax_term", { term: "   " }, mockSupabase, "user-123");
  assert.ok(res.includes("Please provide a term to look up"));
});
