import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface CsvRow {
  date: string;
  amount: string;
  description: string;
  type: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to import records." }, { status: 401 });
  }

  const text = await request.text().catch(() => null);
  if (!text) {
    return NextResponse.json({ error: "Invalid CSV body." }, { status: 400 });
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header row and at least one data row." }, { status: 400 });
  }

  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = headers.indexOf("date");
  const amountIdx = headers.indexOf("amount");
  const descIdx = headers.indexOf("description");
  const typeIdx = headers.indexOf("type");

  if (dateIdx < 0 || amountIdx < 0 || descIdx < 0 || typeIdx < 0) {
    return NextResponse.json({
      error: "CSV must have columns: date, amount, description, type",
    }, { status: 400 });
  }

  const inserts: {
    user_id: string;
    import_date: string;
    amount_pence: number;
    description: string;
    record_type: string;
    source: string;
    raw_row: CsvRow;
  }[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cols = splitCsvLine(dataLines[i]);
    const rawRow: CsvRow = {
      date: cols[dateIdx] ?? "",
      amount: cols[amountIdx] ?? "",
      description: cols[descIdx] ?? "",
      type: cols[typeIdx] ?? "",
    };

    const dateStr = rawRow.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      parseErrors.push(`Row ${i + 2}: date must be YYYY-MM-DD, got "${dateStr}"`);
      continue;
    }

    const amountRaw = rawRow.amount.replace(/[£,\s]/g, "");
    const amountFloat = parseFloat(amountRaw);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      parseErrors.push(`Row ${i + 2}: amount must be a positive number, got "${rawRow.amount}"`);
      continue;
    }
    const amount_pence = Math.round(amountFloat * 100);

    const description = rawRow.description.trim();
    if (!description) {
      parseErrors.push(`Row ${i + 2}: description is required`);
      continue;
    }

    const record_type = rawRow.type.trim().toLowerCase();
    if (record_type !== "income" && record_type !== "expense") {
      parseErrors.push(`Row ${i + 2}: type must be 'income' or 'expense', got "${rawRow.type}"`);
      continue;
    }

    inserts.push({
      user_id: user.id,
      import_date: dateStr,
      amount_pence,
      description,
      record_type,
      source: "csv_import",
      raw_row: rawRow,
    });
  }

  if (inserts.length === 0) {
    return NextResponse.json({ error: "No valid rows to import.", parseErrors }, { status: 400 });
  }

  const { data: staged, error: insertError } = await supabase
    .from("record_imports")
    .insert(inserts)
    .select("id, import_date, amount_pence, description, record_type, suggested_category, status");

  if (insertError) {
    return NextResponse.json({ error: "Could not stage the import." }, { status: 500 });
  }

  return NextResponse.json({ staged: staged ?? [], parseErrors }, { status: 201 });
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}
