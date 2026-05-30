import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SUGGESTION_MODEL = process.env.VIBECOUNT_EXTRACTION_MODEL || "claude-sonnet-4-20250514";

type CategoryRow = { id: string; name: string; record_type: string };
type RecordRow = {
  id: string;
  record_type: string;
  description: string;
  amount: number | string;
  category_id: string | null;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const recordId = searchParams.get("recordId");
  if (!recordId) return NextResponse.json({ error: "Missing recordId." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI suggestions are not configured." }, { status: 503 });

  const [{ data: record }, { data: categories }] = await Promise.all([
    supabase
      .from("financial_records")
      .select("id, record_type, description, amount, category_id")
      .eq("id", recordId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("record_categories")
      .select("id, name, record_type")
      .or(`user_id.eq.${user.id},is_default.eq.true`),
  ]);

  if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });

  const typedRecord = record as RecordRow;
  const typedCategories = (categories ?? []) as CategoryRow[];

  const matchingCategories = typedCategories.filter(
    (c) => c.record_type === typedRecord.record_type
  );

  if (matchingCategories.length === 0) {
    return NextResponse.json({ error: "No categories found for this record type." }, { status: 422 });
  }

  const categoryList = matchingCategories
    .map((c) => `- id: "${c.id}", name: "${c.name}"`)
    .join("\n");

  const prompt = `You are categorising a financial record for a UK freelancer.

Available ${typedRecord.record_type} categories:
${categoryList}

Record to categorise:
- Type: ${typedRecord.record_type}
- Description: ${typedRecord.description}
- Amount: £${Number(typedRecord.amount).toFixed(2)}

Choose the best matching category from the list above. Reply with ONLY raw valid JSON — no markdown, no code fences:
{"categoryId": "<id from list>", "categoryName": "<name from list>", "reason": "<one short plain-English sentence explaining why>"}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SUGGESTION_MODEL,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error("Anthropic suggest-category error:", response.status);
    return NextResponse.json({ error: "AI suggestion failed. Try again shortly." }, { status: 502 });
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  const raw = data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  let parsed: { categoryId: string; categoryName: string; reason: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("Bad AI suggest-category response:", raw.slice(0, 200));
    return NextResponse.json({ error: "Could not parse AI suggestion." }, { status: 502 });
  }

  const matched = matchingCategories.find((c) => c.id === parsed.categoryId);
  if (!matched) {
    return NextResponse.json({ error: "AI suggested an unknown category." }, { status: 502 });
  }

  return NextResponse.json({
    categoryId: matched.id,
    categoryName: matched.name,
    reason: String(parsed.reason ?? "").slice(0, 200),
  });
}
