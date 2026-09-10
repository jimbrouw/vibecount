import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";

export const runtime = "nodejs";

const REVIEW_MODEL = process.env.VIBECOUNT_EXTRACTION_MODEL || "claude-sonnet-4-20250514";

type RecordSummaryItem = {
  record_type: string;
  record_date: string;
  description: string;
  amount: number;
  category: string | null;
  status: string;
};

type InvoiceSummaryItem = {
  number: string;
  amount: number;
  due_date: string | null;
  delivery_status: string;
  client: string;
};

type QuarterItem = {
  label: string;
  incomeTotal: number;
  expenseTotal: number;
  netProfit: number;
  recordCount: number;
};

type ReviewSummary = {
  currentTaxYear: string;
  approvedCount: number;
  reviewCount: number;
  quarters: QuarterItem[];
  recentRecords: RecordSummaryItem[];
  overdueInvoices: InvoiceSummaryItem[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const body = await request.json() as { summary: ReviewSummary };
  const { summary } = body;
  if (!summary) return NextResponse.json({ error: "Missing summary." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI review is not configured." }, { status: 503 });

  const prompt = buildReviewPrompt(summary);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      max_tokens: 1024,
      system: `You are a read-only financial review assistant for a UK freelancer invoicing tool. You inspect financial records and surface what needs attention. You never write to any database or trigger any external actions. Your role is to help the user understand their records and identify gaps — not to make decisions for them.

Be concise, friendly, and specific. Use plain English. No jargon. Format your response as a short list of observations with clear action suggestions. Do not repeat figures the user can already see.`,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("Anthropic review error:", response.status, text.slice(0, 200));
    return NextResponse.json({ error: "AI review failed. Try again shortly." }, { status: 502 });
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";

  return NextResponse.json({ suggestion: text });
}

function buildReviewPrompt(summary: ReviewSummary): string {
  const lines: string[] = [];

  lines.push(`Tax year: ${summary.currentTaxYear}`);
  lines.push(`Approved records: ${summary.approvedCount}`);
  lines.push(`Records awaiting your review: ${summary.reviewCount}`);
  lines.push("");

  if (summary.quarters.length > 0) {
    lines.push("Quarter summaries (net profit = income − expenses):");
    for (const q of summary.quarters) {
      lines.push(
        `  ${q.label}: income £${(q.incomeTotal / 100).toFixed(2)}, expenses £${(q.expenseTotal / 100).toFixed(2)}, net profit £${(q.netProfit / 100).toFixed(2)}, ${q.recordCount} records`
      );
    }
    lines.push("");
  }

  if (summary.recentRecords.length > 0) {
    lines.push("Recent approved records (last 20):");
    for (const r of summary.recentRecords) {
      const cat = r.category ?? "Uncategorised";
      lines.push(
        `  ${r.record_date} | ${r.record_type} | £${(r.amount / 100).toFixed(2)} | ${cat} | ${redactBankDetailsForPrompt(r.description)}`
      );
    }
    lines.push("");
  }

  if (summary.overdueInvoices.length > 0) {
    lines.push("Invoices sent but not marked paid:");
    for (const inv of summary.overdueInvoices) {
      lines.push(
        `  Invoice ${redactBankDetailsForPrompt(inv.number)} | ${redactBankDetailsForPrompt(inv.client)} | £${(inv.amount / 100).toFixed(2)} | due ${inv.due_date ?? "unknown"}`
      );
    }
    lines.push("");
  }

  lines.push(
    "Based on the above, please identify: (1) any records or invoices that need the user's attention, (2) categories that look unusual or might be miscategorised, (3) gaps in the quarter record, (4) any invoices overdue for follow-up. Keep it short — 5 to 8 bullet points maximum."
  );

  return lines.join("\n");
}
