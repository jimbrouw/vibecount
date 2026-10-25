import { SupabaseClient } from "@supabase/supabase-js";
import { formatPounds, amountToWords, normaliseClientName, parseAmountToPence } from "@/lib/invoices/money";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";

// ── Tool definitions (MCP 2024-11-05 JSON Schema format) ─────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "get_tax_year_summary",
    description:
      "Get a breakdown of income, deductible expenses, net profit, and estimated tax pot reserve for a UK tax year. All figures include written-word equivalents and HMRC disclaimers.",
    input_schema: {
      type: "object" as const,
      properties: {
        tax_year_start: {
          type: "number",
          description:
            "Starting calendar year of the UK tax year (e.g. 2026 for 2026/27). Defaults to current active tax year.",
        },
      },
    },
  },
  {
    name: "list_invoices",
    description:
      "List the user's VibeCount invoices with status, client name, issue date, and amounts in both numbers and words.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of invoices to return (default 20, max 100).",
        },
        status: {
          type: "string",
          enum: ["draft", "sent", "paid", "overdue"],
          description: "Optional filter by invoice status.",
        },
      },
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create a draft invoice in VibeCount. STRICT SAFETY RULE: This tool creates a draft only. It never finalises, commits, or sends invoices. The user must review in VibeCount.",
    input_schema: {
      type: "object" as const,
      properties: {
        client: {
          type: "string",
          description: "Client name.",
        },
        amount: {
          type: "number",
          description: "Invoice total amount in GBP (e.g. 1500.00).",
        },
        description: {
          type: "string",
          description: "Description of services rendered or line item summary.",
        },
        payment_terms: {
          type: "string",
          description: "Optional payment terms (e.g. 'Payment due within 30 days').",
        },
      },
      required: ["client", "amount", "description"],
    },
  },
  {
    name: "stage_spreadsheet_import",
    description:
      "Stage an array of historical or spreadsheet transactions (invoices and expenses) into VibeCount as unconfirmed drafts. The user must review and approve them in VibeCount before they count towards official accounts.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: {
          type: "string",
          description: "Label or filename for this batch (e.g. 'April-June 2026 Historical Spreadsheets').",
        },
        records: {
          type: "array",
          description: "List of transactions to stage.",
          items: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Transaction date in YYYY-MM-DD format (e.g. '2026-05-14').",
              },
              description: {
                type: "string",
                description: "Description or merchant name.",
              },
              amount: {
                type: "number",
                description: "Positive amount in GBP (e.g. 149.99).",
              },
              type: {
                type: "string",
                enum: ["income", "expense"],
                description: "Whether this is an income payout or an expense.",
              },
              category_name: {
                type: "string",
                description: "Optional category name (e.g. 'Travel costs', 'Office costs', 'Sales').",
              },
            },
            required: ["date", "description", "amount", "type"],
          },
        },
      },
      required: ["source_name", "records"],
    },
  },
  {
    name: "explain_tax_term",
    description:
      "Look up a UK tax or accounting term in VibeCount's verified, accountant-reviewed glossary (e.g. 'Self Assessment', 'Payments on Account', 'Cash Basis').",
    input_schema: {
      type: "object" as const,
      properties: {
        term: {
          type: "string",
          description: "The term to look up.",
        },
      },
      required: ["term"],
    },
  },
  {
    name: "list_tax_terms",
    description: "List all UK tax and accounting terms available in the curated VibeCount glossary.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const;

// ── MCP-spec tool list export ─────────────────────────────────────────────────

export const MCP_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
}));

// ── Tool execution dispatcher ─────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  switch (name) {
    case "get_tax_year_summary":
      return getTaxYearSummary(input, supabase, userId);
    case "list_invoices":
      return listInvoices(input, supabase, userId);
    case "create_invoice_draft":
      return createInvoiceDraft(input, supabase, userId);
    case "stage_spreadsheet_import":
      return stageSpreadsheetImport(input, supabase, userId);
    case "explain_tax_term":
      return explainTaxTerm(input, supabase);
    case "list_tax_terms":
      return listTaxTerms(supabase);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function getTaxYearSummary(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const currentStart = getCurrentTaxYearStart();
  const taxYearStart = Number(input.tax_year_start) || currentStart;
  const label = getTaxYearLabel(taxYearStart);

  // Fetch user settings for tax pot percentage
  const { data: settings } = await supabase
    .from("user_settings")
    .select("tax_pot_percentage")
    .eq("id", userId)
    .maybeSingle();

  const potPercentage = Number(settings?.tax_pot_percentage) || 27.0;

  // Query financial records for this tax year
  const { data: records, error } = await supabase
    .from("financial_records")
    .select("record_type, amount, status")
    .eq("user_id", userId)
    .eq("tax_year_start", taxYearStart);

  if (error) {
    return `Error fetching tax records: ${error.message}`;
  }

  let approvedIncomePence = 0;
  let approvedExpensePence = 0;
  let draftCount = 0;

  for (const r of records ?? []) {
    const pence = Math.round(Number(r.amount) * 100);
    if (r.status === "approved") {
      if (r.record_type === "income") approvedIncomePence += pence;
      if (r.record_type === "expense") approvedExpensePence += pence;
    } else if (r.status === "draft" || r.status === "review") {
      draftCount++;
    }
  }

  const netProfitPence = Math.max(0, approvedIncomePence - approvedExpensePence);
  const estimatedTaxReservePence = Math.round(netProfitPence * (potPercentage / 100));

  const lines = [
    `UK Tax Year ${label} Summary (6 Apr ${taxYearStart} – 5 Apr ${taxYearStart + 1}):`,
    `  • Approved Income: ${formatPounds(approvedIncomePence)} (${amountToWords(approvedIncomePence)})`,
    `  • Approved Deductible Expenses: ${formatPounds(approvedExpensePence)} (${amountToWords(approvedExpensePence)})`,
    `  • Net Profit: ${formatPounds(netProfitPence)} (${amountToWords(netProfitPence)})`,
    `  • Recommended Tax Pot Reserve (${potPercentage}%): ${formatPounds(estimatedTaxReservePence)} (${amountToWords(estimatedTaxReservePence)})`,
  ];

  if (draftCount > 0) {
    lines.push(
      ``,
      `  ⚠️ Pending Attention: There are ${draftCount} unconfirmed draft records waiting for review at /dashboard/records?status=draft.`
    );
  }

  lines.push(
    ``,
    `Notice: This is an automated preparation estimate based on approved records. It is not an HMRC submission or formal tax advice.`
  );

  return lines.join("\n");
}

async function listInvoices(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
  const status = typeof input.status === "string" ? input.status.trim() : null;

  let query = supabase
    .from("invoices")
    .select("number, invoice_date, amount, status, clients(name)")
    .eq("user_id", userId)
    .order("invoice_date", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return `Error fetching invoices: ${error.message}`;
  if (!data || data.length === 0) return "No invoices found matching criteria.";

  type Row = {
    number: string;
    invoice_date: string;
    amount: number;
    status: string;
    clients: { name: string } | null;
  };

  const rows = (data as unknown as Row[]).map((inv) => {
    const pence = Math.round(Number(inv.amount) * 100);
    const client = inv.clients?.name ?? "No client specified";
    return `• ${inv.number} | ${client} | ${inv.invoice_date} | Status: ${inv.status} | ${formatPounds(pence)} (${amountToWords(pence)})`;
  });

  return `Invoices (${rows.length}):\n${rows.join("\n")}`;
}

async function createInvoiceDraft(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const clientName = String(input.client ?? "").trim();
  const amount = Number(input.amount);
  const description = String(input.description ?? "").trim();
  const paymentTerms = String(input.payment_terms ?? "").trim() || "Payment due within 30 days";

  if (!clientName) return "Error: client name is required.";
  if (!Number.isFinite(amount) || amount <= 0) return "Error: valid positive amount is required.";
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
    const { data: inserted, error: insertError } = await supabase
      .from("clients")
      .insert({ user_id: userId, name: normalised })
      .select("id, name")
      .single();
    if (insertError || !inserted) return "Error: could not register client.";
    client = inserted as ClientRow;
  }

  // Generate invoice number
  const { data: settings } = await supabase
    .from("user_settings")
    .select("invoice_number_prefix")
    .eq("id", userId)
    .maybeSingle();

  const prefix = settings?.invoice_number_prefix?.trim() || "VC";
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

  if (error || !invoice) {
    return `Error creating invoice draft: ${error?.message ?? "unknown error"}`;
  }

  const pence = Math.round(amount * 100);

  return [
    `Invoice draft created successfully:`,
    `  • Invoice Number: ${invoice.number}`,
    `  • Client: ${client.name}`,
    `  • Amount: ${formatPounds(pence)} (${amountToWords(pence)})`,
    `  • Date: ${today}`,
    `  • Payment Terms: ${paymentTerms}`,
    `  • Status: draft (NOT final, NOT sent)`,
    ``,
    `Human Review Gate: The user must review and finalise this invoice in VibeCount at /dashboard/invoices.`,
  ].join("\n");
}

async function stageSpreadsheetImport(
  input: ToolInput,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const sourceName = String(input.source_name ?? "Spreadsheet Import").trim();
  const rawRecords = Array.isArray(input.records) ? input.records : [];

  if (!rawRecords.length) {
    return "Error: records array is empty. Please provide at least one transaction to stage.";
  }

  // Fetch available categories for mapping
  const { data: categories } = await supabase
    .from("record_categories")
    .select("id, name, record_type")
    .or(`user_id.eq.${userId},is_default.eq.true`);

  type CategoryRow = { id: string; name: string; record_type: string };
  const categoryList = (categories as CategoryRow[] | null) ?? [];

  const stagedRows: Array<{
    user_id: string;
    record_type: "income" | "expense";
    record_date: string;
    description: string;
    amount: number;
    category_id: string | null;
    source_type: "csv";
    source_reference: string;
    status: "draft";
  }> = [];

  let totalIncomePence = 0;
  let totalExpensePence = 0;

  for (let i = 0; i < rawRecords.length; i++) {
    const item = rawRecords[i] as Record<string, unknown>;
    const date = String(item.date ?? "").trim();
    const desc = String(item.description ?? "").trim();
    const amount = Number(item.amount);
    const type = item.type === "income" ? "income" : item.type === "expense" ? "expense" : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return `Error in row ${i + 1}: invalid date "${date}". Expected YYYY-MM-DD.`;
    }
    if (!desc) {
      return `Error in row ${i + 1}: description cannot be blank.`;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return `Error in row ${i + 1}: amount must be a positive number.`;
    }
    if (!type) {
      return `Error in row ${i + 1}: type must be either 'income' or 'expense'.`;
    }

    // Match category if provided
    let categoryId: string | null = null;
    const catName = typeof item.category_name === "string" ? item.category_name.trim().toLowerCase() : "";
    if (catName) {
      const match = categoryList.find(
        (c) => c.record_type === type && c.name.toLowerCase() === catName
      );
      if (match) categoryId = match.id;
    }

    const pence = Math.round(amount * 100);
    if (type === "income") totalIncomePence += pence;
    if (type === "expense") totalExpensePence += pence;

    stagedRows.push({
      user_id: userId,
      record_type: type,
      record_date: date,
      description: desc,
      amount,
      category_id: categoryId,
      source_type: "csv",
      source_reference: sourceName,
      status: "draft",
    });
  }

  // Batch insert into financial_records with status = 'draft'
  const { error: insertError } = await supabase
    .from("financial_records")
    .insert(stagedRows);

  if (insertError) {
    return `Error staging transactions: ${insertError.message}`;
  }

  return [
    `Staged ${stagedRows.length} transactions from "${sourceName}" as DRAFTS:`,
    `  • Staged Income: ${formatPounds(totalIncomePence)} (${amountToWords(totalIncomePence)})`,
    `  • Staged Expenses: ${formatPounds(totalExpensePence)} (${amountToWords(totalExpensePence)})`,
    ``,
    `Human Confirmation Required:`,
    `All rows have been staged with status = 'draft' in VibeCount.`,
    `They will NOT affect your official tax calculations until confirmed.`,
    `Open /dashboard/records?status=draft to review and approve them.`,
  ].join("\n");
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
    return `No glossary entry found for "${term}". Use list_tax_terms to view available verified terms.`;
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
  return `Curated UK Tax Glossary Terms:\n${terms.join(", ")}`;
}
