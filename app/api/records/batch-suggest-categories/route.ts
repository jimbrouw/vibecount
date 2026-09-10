import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";

export const runtime = "nodejs";

const SUGGESTION_MODEL = process.env.VIBECOUNT_EXTRACTION_MODEL || "claude-sonnet-4-20250514";
const MAX_RECORDS = 50;

type CategoryRow = { id: string; name: string; record_type: string };
type RecordRow = {
  id: string;
  record_type: string;
  description: string;
  amount: number | string;
};

export type BatchSuggestion = {
  recordId: string;
  description: string;
  amount: number;
  recordType: string;
  categoryId: string;
  categoryName: string;
  reason: string;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI suggestions are not configured." }, { status: 503 });

  const [{ data: records }, { data: categories }] = await Promise.all([
    supabase
      .from("financial_records")
      .select("id, record_type, description, amount")
      .eq("user_id", user.id)
      .is("category_id", null)
      .in("status", ["review", "approved"])
      .order("record_date", { ascending: false })
      .limit(MAX_RECORDS),
    supabase
      .from("record_categories")
      .select("id, name, record_type")
      .or(`user_id.eq.${user.id},is_default.eq.true`),
  ]);

  const typedRecords = (records ?? []) as RecordRow[];
  const typedCategories = (categories ?? []) as CategoryRow[];

  if (typedRecords.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const incomeCategories = typedCategories.filter((c) => c.record_type === "income");
  const expenseCategories = typedCategories.filter((c) => c.record_type === "expense");

  const incomeCatList = incomeCategories.map((c) => `  - id: "${c.id}", name: "${c.name}"`).join("\n");
  const expenseCatList = expenseCategories.map((c) => `  - id: "${c.id}", name: "${c.name}"`).join("\n");

  const recordList = typedRecords
    .map((r, i) => `${i + 1}. id: "${r.id}" | type: ${r.record_type} | description: "${redactBankDetailsForPrompt(r.description)}" | £${Number(r.amount).toFixed(2)}`)
    .join("\n");

  const prompt = `You are categorising financial records for a UK freelancer.

Available income categories:
${incomeCatList || "  (none)"}

Available expense categories:
${expenseCatList || "  (none)"}

Records to categorise (each has a type — match only to categories of the same type):
${recordList}

Reply with ONLY a raw valid JSON array, no markdown, no code fences. One object per record:
[{"recordId":"<id>","categoryId":"<id from matching type list>","categoryName":"<name>","reason":"<one short plain-English sentence>"}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SUGGESTION_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error("Anthropic batch-suggest error:", response.status);
    return NextResponse.json({ error: "AI suggestion failed. Try again shortly." }, { status: 502 });
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  const raw = data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  let parsed: { recordId: string; categoryId: string; categoryName: string; reason: string }[];
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch {
    console.error("Bad batch-suggest response:", raw.slice(0, 300));
    return NextResponse.json({ error: "Could not parse AI suggestions." }, { status: 502 });
  }

  const recordMap = new Map(typedRecords.map((r) => [r.id, r]));
  const categoryMap = new Map(typedCategories.map((c) => [c.id, c]));

  const suggestions: BatchSuggestion[] = [];
  for (const item of parsed) {
    const record = recordMap.get(item.recordId);
    const category = categoryMap.get(item.categoryId);
    if (!record || !category) continue;
    if (category.record_type !== record.record_type) continue;

    suggestions.push({
      recordId: record.id,
      description: redactBankDetailsForPrompt(record.description),
      amount: Number(record.amount),
      recordType: record.record_type,
      categoryId: category.id,
      categoryName: category.name,
      reason: String(item.reason ?? "").slice(0, 200),
    });
  }

  return NextResponse.json({ suggestions });
}
