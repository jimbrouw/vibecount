import { SupabaseClient } from "@supabase/supabase-js";
import { formatPounds, amountToWords, normaliseClientName } from "@/lib/invoices/money";

// ── Tool definitions (MCP + Claude API format) ───────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "list_invoices",
    description:
      "List the user's VibeCount invoices. Returns invoice number, client name, amount (figures and words), date, and status.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of invoices to return (default 20, max 100).",
        },
        status: {
          type: "string",
          enum: ["draft", "finalised"],
          description: "Filter by invoice status.",
        },
      },
    },
  },
  {
    name: "get_income_summary",
    description:
      "Get a summary of invoiced income: total this UK tax year, total by client, invoice counts by status.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_clients",
    description: "List the user's saved clients.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "explain_tax_term",
    description:
      "Look up a UK tax or accounting term from the VibeCount glossary and return a plain-English explanation with an example.",
    input_schema: {
      type: "object" as const,
      properties: {
        term: {
          type: "string",
          description: "The term to look up, e.g. 'Self Assessment', 'VAT', 'UTR'.",
        },
      },
      required: ["term"],
    },
  },
  {
    name: "list_tax_terms",
    description: "List all UK tax and accounting terms available in the VibeCount glossary.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create a draft invoice in VibeCount. The user must open VibeCount to review and finalise it — this tool never submits or sends anything automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        client: {
          type: "string",
          description: "Client name.",
        },
        amount: {
          type: "number",
          description: "Invoice amount in GBP (e.g. 850.00).",
        },
        description: {
          type: "string",
          description: "What the invoice is for.",
        },
        payment_terms: {
          type: "string",
          description: "Payment terms (e.g. 'Payment due within 30 days').",
        },
      },
      required: ["client", "amount", "description"],
    },
  },
] as const;

// ── MCP-spec tool list ────────────────────────────────────────────────────────

export const MCP_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
}));

// ── Tool execution ────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  switch (name) {
    case "list_invoices":
      return listInvoices(input, supabase, userId);
    case "get_income_summary":
      return getIncomeSummary(supabase, userId);
    case "list_clients":
      return listClients(supabase, userId);
    case "explain_tax_term":
      return explainTaxTerm(input, supabase);
    case "list_tax_terms":
      return listTaxTerms(supabase);
    case "create_invoice_draft":
      return createInvoiceDraft(input, supabase, userId);
    default:
      return `Unknown tool: ${name}`;
  }
}

async function listInvoices(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 100);

  let query = supabase
    .from("invoices")
    .select("number, invoice_date, amount, status, clients(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status === "draft" || input.status === "finalised") {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;

  if (error) return `Error fetching invoices: ${error.message}`;
  if (!data || data.length === 0) return "No invoices found.";

  type InvoiceRow = {
    number: string;
    invoice_date: string;
    amount: string | number;
    status: string;
    clients: { name: string } | { name: string }[] | null;
  };

  const rows = (data as unknown as InvoiceRow[]).map((inv) => {
    const clientData = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
    const pence = Math.round(Number(inv.amount) * 100);
    const client = clientData?.name ?? "Unknown client";
    const date = inv.invoice_date
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
          new Date(`${inv.invoice_date}T00:00:00Z`)
        )
      : "—";
    return `${inv.number} | ${client} | ${formatPounds(pence)} (${amountToWords(pence)}) | ${date} | ${inv.status}`;
  });

  return `Invoices (${rows.length} shown):\n${rows.join("\n")}`;
}

async function getIncomeSummary(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("invoices")
    .select("amount, status, invoice_date, clients(name)")
    .eq("user_id", userId);

  if (error) return `Error fetching invoices: ${error.message}`;
  if (!data || data.length === 0) return "No invoices found.";

  type InvRow = { amount: string | number; status: string; invoice_date: string; clients: { name: string } | { name: string }[] | null };
  const invoices = data as unknown as InvRow[];

  // Current UK tax year: 6 April to 5 April
  const today = new Date();
  const taxYearStart = ukTaxYearStart(today);

  let totalPenceThisYear = 0;
  let finalisedThisYear = 0;
  let draftCount = 0;
  const byClient: Record<string, number> = {};

  for (const inv of invoices) {
    const pence = Math.round(Number(inv.amount) * 100);
    const date = new Date(`${inv.invoice_date}T00:00:00Z`);

    if (inv.status === "draft") {
      draftCount++;
    }

    if (inv.status === "finalised" && date >= taxYearStart) {
      totalPenceThisYear += pence;
      finalisedThisYear++;
      const clientData = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
      const client = clientData?.name ?? "Unknown";
      byClient[client] = (byClient[client] ?? 0) + pence;
    }
  }

  const taxYear = formatTaxYear(today);
  const topClients = Object.entries(byClient)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, pence]) => `  ${name}: ${formatPounds(pence)}`)
    .join("\n");

  return [
    `Tax year ${taxYear}:`,
    `  Finalised invoices: ${finalisedThisYear}`,
    `  Total invoiced: ${formatPounds(totalPenceThisYear)} (${amountToWords(totalPenceThisYear)})`,
    topClients ? `\nTop clients:\n${topClients}` : "",
    `\nDraft invoices (all time): ${draftCount}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function listClients(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("clients")
    .select("name, created_at")
    .eq("user_id", userId)
    .order("name");

  if (error) return `Error fetching clients: ${error.message}`;
  if (!data || data.length === 0) return "No saved clients yet.";

  const names = (data as Array<{ name: string }>).map((c) => c.name);
  return `Saved clients (${names.length}):\n${names.join("\n")}`;
}

async function explainTaxTerm(input: ToolInput, supabase: SupabaseClient): Promise<string> {
  const term = String(input.term ?? "").trim();
  if (!term) return "Please provide a term to look up.";

  const { data } = await supabase
    .from("glossary_terms")
    .select("term, explanation, example")
    .ilike("term", `%${term}%`)
    .limit(3);

  if (!data || data.length === 0) {
    return `No glossary entry found for "${term}". Try list_tax_terms to see available terms.`;
  }

  const rows = (data as Array<{ term: string; explanation: string; example: string }>).map(
    (row) => `**${row.term}**\n${row.explanation}\n\nExample: ${row.example}`
  );

  return rows.join("\n\n---\n\n");
}

async function listTaxTerms(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("glossary_terms")
    .select("term")
    .order("sort_order")
    .order("term");

  if (!data || data.length === 0) return "No glossary terms found.";

  const terms = (data as Array<{ term: string }>).map((r) => r.term);
  return `Available UK tax terms:\n${terms.join(", ")}`;
}

async function createInvoiceDraft(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const clientName = String(input.client ?? "").trim();
  const amount = Number(input.amount);
  const description = String(input.description ?? "").trim();
  const paymentTerms =
    String(input.payment_terms ?? "").trim() || "Payment due within 30 days";

  if (!clientName) return "Error: client name is required.";
  if (!Number.isFinite(amount) || amount <= 0) return "Error: a valid positive amount is required.";
  if (!description) return "Error: description is required.";

  // Find or create client
  const normalised = normaliseClientName(clientName);
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", userId);

  type ClientRow = { id: string; name: string };
  let client = (clients as ClientRow[] | null)?.find(
    (c) => normaliseClientName(c.name).toLowerCase() === normalised.toLowerCase()
  );

  if (!client) {
    const { data: inserted } = await supabase
      .from("clients")
      .insert({ user_id: userId, name: normalised })
      .select("id, name")
      .single();
    if (!inserted) return "Error: could not save the client.";
    client = inserted as ClientRow;
  }

  // Generate invoice number
  const { data: settings } = await supabase
    .from("user_settings")
    .select("invoice_number_prefix")
    .eq("id", userId)
    .maybeSingle();

  const prefix = (settings as { invoice_number_prefix?: string } | null)?.invoice_number_prefix?.trim() || "VC";
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const number = `${prefix}-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const today = new Date().toISOString().slice(0, 10);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      user_id: userId,
      client_id: client.id,
      number,
      invoice_date: today,
      description,
      amount,
      payment_terms: paymentTerms,
      status: "draft",
    })
    .select("id, number")
    .single();

  if (error || !invoice) return `Error creating draft: ${error?.message ?? "unknown error"}`;

  const inv = invoice as { id: string; number: string };
  const pence = Math.round(amount * 100);

  return [
    `Draft invoice created:`,
    `  Number: ${inv.number}`,
    `  Client: ${client.name}`,
    `  Amount: ${formatPounds(pence)} (${amountToWords(pence)})`,
    `  Description: ${description}`,
    `  Payment terms: ${paymentTerms}`,
    ``,
    `The user must open VibeCount to review and finalise this invoice before it can be sent.`,
  ].join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ukTaxYearStart(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;
  return new Date(`${startYear}-04-06T00:00:00Z`);
}

function formatTaxYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}
