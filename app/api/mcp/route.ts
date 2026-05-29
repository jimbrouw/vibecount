/**
 * VibeCount MCP Server — MCP 2024-11-05 over HTTP (Streamable HTTP transport).
 *
 * Authentication: Bearer token in the Authorization header.
 * The token is the vibecount_api_key generated in Settings → Agent.
 *
 * Connect your agent: POST https://vibecount-teal.vercel.app/api/mcp
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { MCP_TOOLS, executeTool } from "@/lib/agent/tools";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "vibecount", version: "1.0.0" };

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const service = createServiceClient();
  const { data: row, error: lookupError } = await service
    .from("user_settings")
    .select("id")
    .eq("vibecount_api_key", token)
    .maybeSingle();

  if (lookupError || !row) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = row.id as string;

  // Scoped client: uses service role but every query is filtered to userId.
  // This is equivalent to session-scoped RLS for external agents.
  const supabase = createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── Parse JSON-RPC ────────────────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const { method, id = null, params = {} } = body as {
    method: string;
    id?: number | string | null;
    params?: Record<string, unknown>;
  };

  // Notifications (no id) → 204 No Content
  if (id === undefined || id === null) {
    return new Response(null, { status: 204 });
  }

  // ── Method dispatch ───────────────────────────────────────────────────────
  switch (method) {
    case "initialize":
      return NextResponse.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      );

    case "tools/list":
      return NextResponse.json(rpcResult(id, { tools: MCP_TOOLS }));

    case "tools/call": {
      const toolName = String((params as Record<string, unknown>).name ?? "");
      const toolInput = ((params as Record<string, unknown>).arguments ?? {}) as Record<string, unknown>;

      const known = MCP_TOOLS.some((t) => t.name === toolName);
      if (!known) {
        return NextResponse.json(rpcError(id, -32602, `Unknown tool: ${toolName}`));
      }

      try {
        const text = await executeTool(toolName, toolInput, supabase, userId);
        return NextResponse.json(
          rpcResult(id, {
            content: [{ type: "text", text }],
            isError: false,
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return NextResponse.json(
          rpcResult(id, {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
          })
        );
      }
    }

    default:
      return NextResponse.json(rpcError(id, -32601, "Method not found"));
  }
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
