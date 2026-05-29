/**
 * In-app agent chat — uses the user's own Anthropic or OpenAI API key (BYOK).
 * Falls back to the server key if the user has not stored their own.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agent/tools";

export const runtime = "nodejs";

const MAX_TOOL_ROUNDS = 5;

type ChatMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContent[];
};

type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const incomingMessages: ChatMessage[] = body.messages;

  // Load user's BYOK key + agent provider
  const { data: settings } = await supabase
    .from("user_settings")
    .select("agent_api_key, agent_provider, legal_name, vat_registered")
    .eq("id", user.id)
    .maybeSingle();

  const agentKey =
    (settings as { agent_api_key?: string } | null)?.agent_api_key ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  const provider =
    (settings as { agent_provider?: string } | null)?.agent_provider === "openai"
      ? "openai"
      : "anthropic";

  if (!agentKey) {
    return NextResponse.json(
      { error: "No agent API key found. Add your Anthropic or OpenAI key in Settings → Agent." },
      { status: 400 }
    );
  }

  const systemPrompt = buildSystemPrompt(
    (settings as { legal_name?: string } | null)?.legal_name ?? "",
    Boolean((settings as { vat_registered?: boolean } | null)?.vat_registered)
  );

  // Run the agentic tool-calling loop
  try {
    const reply = await runAgentLoop(
      incomingMessages,
      systemPrompt,
      agentKey,
      provider,
      supabase as Parameters<typeof executeTool>[2],
      user.id
    );
    return NextResponse.json({ role: "assistant", content: reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runAgentLoop(
  messages: ChatMessage[],
  system: string,
  apiKey: string,
  provider: "anthropic" | "openai",
  supabase: Parameters<typeof executeTool>[2],
  userId: string
): Promise<string> {
  const workingMessages: ChatMessage[] = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response =
      provider === "openai"
        ? await callOpenAI(workingMessages, system, apiKey)
        : await callClaude(workingMessages, system, apiKey);

    const { stopReason, text, toolCalls } = response;

    if (stopReason === "end_turn" || stopReason === "stop" || !toolCalls.length) {
      return text || "I have no response.";
    }

    // Execute tool calls and append results
    const assistantContent: ClaudeContent[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...toolCalls.map((tc) => ({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    ];

    workingMessages.push({ role: "assistant", content: assistantContent });

    const toolResultContent: ClaudeContent[] = await Promise.all(
      toolCalls.map(async (tc) => {
        const result = await executeTool(tc.name, tc.input, supabase, userId);
        return { type: "tool_result" as const, tool_use_id: tc.id, content: result };
      })
    );

    workingMessages.push({ role: "user", content: toolResultContent });
  }

  return "I was unable to complete the task within the allowed steps.";
}

// ── Claude API ────────────────────────────────────────────────────────────────

async function callClaude(
  messages: ChatMessage[],
  system: string,
  apiKey: string
): Promise<{ stopReason: string; text: string; toolCalls: ToolCall[] }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.VIBECOUNT_AGENT_MODEL || "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: messages.map(normaliseMessageForClaude),
      tools: TOOL_DEFINITIONS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.content ?? [];

  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === "text") text += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
  }

  return { stopReason: data.stop_reason ?? "end_turn", text, toolCalls };
}

// ── OpenAI API ────────────────────────────────────────────────────────────────

async function callOpenAI(
  messages: ChatMessage[],
  system: string,
  apiKey: string
): Promise<{ stopReason: string; text: string; toolCalls: ToolCall[] }> {
  const openaiMessages = [
    { role: "system", content: system },
    ...messages.flatMap((m) => {
      const r = normaliseMessageForOpenAI(m);
      return Array.isArray(r) ? r : [r];
    }),
  ];

  const tools = TOOL_DEFINITIONS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 2048,
      messages: openaiMessages,
      tools,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};

  const text = msg.content ?? "";
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || "{}"),
    })
  );

  return {
    stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    text,
    toolCalls,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ToolCall = { id: string; name: string; input: Record<string, unknown> };

function normaliseMessageForClaude(msg: ChatMessage): Record<string, unknown> {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  return { role: msg.role, content: msg.content };
}

function normaliseMessageForOpenAI(
  msg: ChatMessage
): Record<string, unknown> | Record<string, unknown>[] {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }

  // Convert tool_result blocks to OpenAI tool message format
  const content = msg.content as ClaudeContent[];
  const toolResults = content.filter((c) => c.type === "tool_result") as Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
  }>;

  if (toolResults.length > 0) {
    return toolResults.map((tr) => ({
      role: "tool",
      tool_call_id: tr.tool_use_id,
      content: tr.content,
    }));
  }

  const textBlocks = content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  const toolUseBlocks = content.filter((c) => c.type === "tool_use") as Array<{
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;

  return {
    role: "assistant",
    content: textBlocks || null,
    tool_calls: toolUseBlocks.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.input) },
    })),
  };
}

function buildSystemPrompt(legalName: string, vatRegistered: boolean): string {
  const today = new Date();
  const taxYear = formatTaxYear(today);
  const dateStr = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);

  return `You are a helpful assistant for UK freelancers using VibeCount, an invoicing and financial admin tool.

You help with: invoicing questions, UK tax and accounting terms, financial summaries, and preparing for Self Assessment.

User context:
- Name: ${legalName || "not set"}
- VAT registered: ${vatRegistered ? "yes" : "no"}
- Current UK tax year: ${taxYear}
- Today: ${dateStr}

You have tools to read from the user's VibeCount account (invoices, clients, tax glossary). Use them to give personalised, data-aware answers.

Hard rules — never break these:
- You cannot finalise invoices, submit to HMRC, send invoices, or move money.
- When you create a draft invoice, the user must open VibeCount to review and finalise it.
- For specific tax advice, always recommend the user consults a qualified accountant.
- Never guess financial figures — use your tools to get real data.
- Always show monetary amounts in both figures and words.`;
}

function formatTaxYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}
