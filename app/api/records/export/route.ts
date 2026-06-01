import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ukTaxYearStart, formatTaxYear } from "@/lib/tax/quarters";
import { TAX_ESTIMATE_DISCLAIMER } from "@/lib/tax/estimate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to export records." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const yearStart = searchParams.get("tax_year")
    ? Number(searchParams.get("tax_year"))
    : ukTaxYearStart(now);
  const taxYear = formatTaxYear(yearStart);

  const { data: records, error } = await supabase
    .from("financial_records")
    .select("record_type, record_date, amount_pence, description, category, source, tax_quarter")
    .eq("user_id", user.id)
    .eq("tax_year_start", yearStart)
    .order("record_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not export records." }, { status: 500 });
  }

  const disclaimer = `# VibeCount Records Export — Tax Year ${taxYear}\n# ${TAX_ESTIMATE_DISCLAIMER}\n# This is a review document. Verify all figures with your accountant before filing.\n`;
  const header = "type,date,amount_pounds,description,category,quarter,source\n";
  const rows = (records ?? [])
    .map((r) =>
      [
        r.record_type,
        r.record_date,
        (r.amount_pence / 100).toFixed(2),
        `"${r.description.replace(/"/g, '""')}"`,
        `"${r.category.replace(/"/g, '""')}"`,
        `Q${r.tax_quarter}`,
        r.source,
      ].join(",")
    )
    .join("\n");

  const csv = disclaimer + header + rows;
  const filename = `vibecount-records-${taxYear.replace("/", "-")}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
