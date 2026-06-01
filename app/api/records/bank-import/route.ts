import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Patterns that identify account-level data to redact before any LLM or DB use.
// These are checked against line content; matching lines are dropped.
const REDACT_PATTERNS = [
  /account\s*(number|no\.?|#)\s*:?\s*\d[\d\s-]*/i,
  /sort\s*code\s*:?\s*\d{2}[-\s]\d{2}[-\s]\d{2}/i,
  /iban\s*:?\s*[A-Z]{2}\d{2}[\w\s]{10,}/i,
  /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/, // card numbers
  /opening\s*balance\s*:?\s*[£\d]/i,
  /closing\s*balance\s*:?\s*[£\d]/i,
  /statement\s*(date|period|ref(erence)?)\s*:/i,
];

interface TransactionRow {
  date: string;
  description: string;
  amount_pence: number;
  direction: "in" | "out";
}

interface CategorisedRow extends TransactionRow {
  suggested_category: string;
  record_type: "income" | "expense";
}

const CATEGORISATION_SYSTEM = `You categorise UK bank transactions for a self-employed freelancer.
For each transaction, return: category (from the list), record_type (income or expense), and a short plain_reason.
Category list: income, software, travel, equipment, phone_internet, office_costs, subcontractors, bank_fees, meals, personal_exclude, needs_review.
Rules: incoming money is usually income unless it is a refund or transfer. Keep it short. Never expose account numbers or sort codes.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to import bank records." }, { status: 401 });
  }

  let pdfText: string;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Upload a PDF file as 'file' field." }, { status: 400 });
    }
    // Read file as text — for a prototype this is sufficient; real PDF parsing would use a library.
    // The raw bytes are read into memory only; never written to disk or stored in the database.
    const buffer = Buffer.from(await (file as Blob).arrayBuffer());
    // Attempt naive text extraction from PDF (works for text-based PDFs, not scanned images)
    pdfText = buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  // Redact account-level personal data line by line before any further processing
  const redactedLines = pdfText
    .split(/\r?\n/)
    .filter((line) => !REDACT_PATTERNS.some((re) => re.test(line)));

  const redactedText = redactedLines.join("\n");

  // Parse transaction rows from redacted text
  const transactions = parseTransactions(redactedText);

  if (transactions.length === 0) {
    return NextResponse.json({
      error: "No transaction rows found. Only text-based PDFs are supported in this prototype.",
    }, { status: 422 });
  }

  // Send ONLY the minimum redacted transaction fields to the LLM for category suggestions
  const categorised = await categoriseWithClaude(transactions);

  // Stage rows in record_imports — never store raw PDF, never store account numbers
  const inserts = categorised.map((t) => ({
    user_id: user.id,
    import_date: t.date,
    amount_pence: Math.abs(t.amount_pence),
    description: t.description,
    record_type: t.record_type,
    source: "bank_import",
    suggested_category: t.suggested_category,
    // raw_row only stores the minimum redacted transaction fields — no account data
    raw_row: {
      date: t.date,
      description: t.description,
      amount_pence: t.amount_pence,
      direction: t.direction,
    },
  }));

  const { data: staged, error: insertError } = await supabase
    .from("record_imports")
    .insert(inserts)
    .select("id, import_date, amount_pence, description, record_type, suggested_category, status");

  if (insertError) {
    return NextResponse.json({ error: "Could not stage the import." }, { status: 500 });
  }

  return NextResponse.json({ staged: staged ?? [], count: staged?.length ?? 0 }, { status: 201 });
}

function parseTransactions(text: string): TransactionRow[] {
  const rows: TransactionRow[] = [];
  // Match lines that look like: DD/MM/YYYY or YYYY-MM-DD ... amount
  const dateLineRe = /(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/;
  const amountRe = /([+-]?£?[\d,]+\.\d{2})/g;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const dateMatch = line.match(dateLineRe);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    let isoDate: string;
    if (/\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      isoDate = rawDate;
    } else {
      // DD/MM/YYYY → YYYY-MM-DD
      const [dd, mm, yyyy] = rawDate.split(/[\/\-]/);
      isoDate = `${yyyy}-${mm}-${dd}`;
    }

    const amounts = [...line.matchAll(amountRe)];
    if (amounts.length === 0) continue;

    // Use the last amount match as the transaction amount
    const lastAmount = amounts[amounts.length - 1][1].replace(/[£,]/g, "");
    const amountFloat = parseFloat(lastAmount);
    if (isNaN(amountFloat)) continue;

    const amount_pence = Math.round(Math.abs(amountFloat) * 100);
    if (amount_pence === 0) continue;

    // Remove date and amount from line to get description
    const description = line
      .replace(dateLineRe, "")
      .replace(amountRe, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!description) continue;

    rows.push({
      date: isoDate,
      description,
      amount_pence: amountFloat < 0 ? -amount_pence : amount_pence,
      direction: amountFloat >= 0 ? "in" : "out",
    });
  }

  return rows.slice(0, 100); // prototype limit
}

async function categoriseWithClaude(transactions: TransactionRow[]): Promise<CategorisedRow[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return transactions.map((t) => ({
      ...t,
      suggested_category: t.direction === "in" ? "income" : "needs_review",
      record_type: (t.direction === "in" ? "income" : "expense") as "income" | "expense",
    }));
  }

  try {
    // Send only the minimum redacted fields — no account numbers, no user PII
    const payload = transactions.map((t) => ({
      date: t.date,
      description: t.description,
      amount_pence: t.amount_pence,
      direction: t.direction,
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: CATEGORISATION_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Categorise these transactions. Return a JSON array with the same length. Each item: { "category": "...", "record_type": "income"|"expense" }.\n\n${JSON.stringify(payload)}`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array in response");

    const suggestions: { category: string; record_type: string }[] = JSON.parse(jsonMatch[0]);

    return transactions.map((t, i) => ({
      ...t,
      suggested_category: suggestions[i]?.category ?? "needs_review",
      record_type: (suggestions[i]?.record_type === "income" ? "income" : "expense") as "income" | "expense",
    }));
  } catch {
    // Fall back to direction-based classification if Claude call fails
    return transactions.map((t) => ({
      ...t,
      suggested_category: t.direction === "in" ? "income" : "needs_review",
      record_type: (t.direction === "in" ? "income" : "expense") as "income" | "expense",
    }));
  }
}
