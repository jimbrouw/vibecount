import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";
import {
  buildSelfAssessmentChecklist,
  type SelfAssessmentRecord,
} from "@/lib/records/self-assessment";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to export tax prep." }, { status: 401 });
  }

  const url = new URL(request.url);
  const taxYearStart = Number(url.searchParams.get("taxYearStart")) || getCurrentTaxYearStart();

  const format = url.searchParams.get("format") === "txt" ? "txt" : "csv";

  const { data, error } = await supabase
    .from("financial_records")
    .select("record_type, amount, record_categories(name, sa103_box)")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .eq("tax_year_start", taxYearStart);

  if (error) {
    return NextResponse.json({ error: "Could not export tax prep." }, { status: 500 });
  }

  const checklist = buildSelfAssessmentChecklist(
    (data ?? []) as unknown as SelfAssessmentRecord[]
  );

  let outputContent = "";
  let contentType = "text/csv; charset=utf-8";

  if (format === "txt") {
    contentType = "text/plain; charset=utf-8";
    outputContent = `Tax Prep Summary for ${getTaxYearLabel(taxYearStart)}\n`;
    outputContent += `=================================================\n\n`;
    outputContent += `Estimate and review pack only. This is not tax advice, not a filing calculation, and not a tax return submission.\n`;
    outputContent += `Review with the user or accountant before using any figure.\n\n`;

    outputContent += `Total Income: ${checklist.incomeTotal}\n`;
    outputContent += `Total Expenses: ${checklist.expenseTotal}\n`;
    outputContent += `Net Profit: ${checklist.profitTotal}\n\n`;

    outputContent += `Self Assessment Checklist:\n`;
    outputContent += `-------------------------------------------------\n`;
    checklist.items.forEach((item) => {
      outputContent += `\n[${item.officialLabel}] - ${item.plainEnglish}\n`;
      outputContent += `Suggested Value: ${item.suggestedValue}\n`;
      outputContent += `Source: ${item.dataSource}\n`;
      outputContent += `Review Note: ${item.reviewNote}\n`;
    });
  } else {
    const csv = [
      [
        "form",
        "official_label",
        "plain_english",
        "suggested_value_estimate",
        "fill_mode",
        "data_source",
        "evidence",
        "review_note",
      ],
      [
        "caveat",
        "Tax prep export caveat",
        "Estimate and review pack only. This is not tax advice, not a filing calculation, and not a tax return submission.",
        "",
        "accountant_review",
        "Approved VibeCount records",
        "Uses net profit: income minus expenses.",
        "Review with the user or accountant before using any figure.",
      ],
      ...checklist.items.map((item) => [
        item.form,
        item.officialLabel,
        item.plainEnglish,
        item.suggestedValue,
        item.fillMode,
        item.dataSource,
        item.evidence,
        item.reviewNote,
      ]),
    ]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n");

    outputContent = csv;
  }

  await supabase.from("record_exports").insert({
    user_id: user.id,
    export_type: format === "txt" ? "accountant_pack_txt" : "accountant_pack",
    tax_year_start: taxYearStart,
    completed_at: new Date().toISOString(),
    record_count: checklist.incomeCount + checklist.expenseCount,
    attachment_count: 0,
  });

  return new NextResponse(outputContent, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="vibecount-tax-prep-${getTaxYearLabel(
        taxYearStart
      )}.${format}"`,
    },
  });
}

function escapeCsv(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}
