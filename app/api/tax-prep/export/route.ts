import {
  readConsistentReconciliation,
  readFinancialStamp,
} from "@/lib/records/consistent-reconciliation";
import { readAllExportRows } from "@/lib/records/export-pages";
import { formatPounds } from "@/lib/invoices/money";
import { escapeCsv } from "@/lib/records/export-csv";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentTaxYearStart,
  getTaxYearLabel,
} from "@/lib/records/tax-periods";
import {
  buildSelfAssessmentChecklist,
  countByCategory,
  sumByCategory,
  type SelfAssessmentRecord,
} from "@/lib/records/self-assessment";
import { buildAccountantHandover } from "@/lib/tax/accountant-handover";
import { getEmploymentRecord } from "@/lib/tax/employment";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Sign in to export tax prep." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const taxYearStart =
    Number(url.searchParams.get("taxYearStart")) || getCurrentTaxYearStart();

  const formatParam = url.searchParams.get("format");
  const format =
    formatParam === "txt"
      ? "txt"
      : formatParam === "handover"
        ? "handover"
        : "csv";

  let records: (SelfAssessmentRecord & { id: string })[];
  try {
    records = await readConsistentReconciliation(
      () =>
        readFinancialStamp(() => supabase.rpc("reconciliation_export_stamp")),
      () =>
        readAllExportRows<SelfAssessmentRecord & { id: string }>(
          async (afterId) => {
            let query = supabase
              .from("financial_records")
              .select(
                "id, record_type, amount, effect_sign, cash_effect_pence, cash_treatment, record_categories(name, sa103_box)",
              )
              .eq("user_id", user.id)
              .eq("status", "approved")
              .eq("tax_year_start", taxYearStart)
              .order("id", { ascending: true })
              .limit(500);
            if (afterId) query = query.gt("id", afterId);
            const result = await query;
            return {
              data: result.data as unknown as
                (SelfAssessmentRecord & { id: string })[] | null,
              error: result.error,
            };
          },
        ),
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read a complete tax prep export." },
      { status: 500 },
    );
  }

  const checklist = buildSelfAssessmentChecklist(records);

  let outputContent = "";
  let contentType = "text/csv; charset=utf-8";

  if (format === "handover") {
    contentType = "text/plain; charset=utf-8";
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("legal_name")
      .eq("id", user.id)
      .maybeSingle();

    const employmentDetails = await getEmploymentRecord(user.id, taxYearStart);

    const handover = buildAccountantHandover({
      userName:
        userSettings?.legal_name || user.email?.split("@")[0] || "Sole Trader",
      taxYearStart,
      incomeTotalPence: checklist.incomeTotal,
      expenseTotalPence: checklist.expenseTotal,
      profitTotalPence: checklist.profitTotal,
      incomeCount: checklist.incomeCount,
      expenseCount: checklist.expenseCount,
      employmentDetails,
      sa103Boxes: [
        {
          box: "Box 17",
          label: "Cost of goods bought for resale",
          amountPence: sumByCategory(records, ["cost of goods"]),
          count: countByCategory(records, ["cost of goods"]),
        },
        {
          box: "Box 18",
          label: "Car, van and travel expenses",
          amountPence: sumByCategory(records, ["travel costs"]),
          count: countByCategory(records, ["travel costs"]),
        },
        {
          box: "Box 19",
          label: "Wages, salaries and other staff costs",
          amountPence: sumByCategory(records, ["staff costs"]),
          count: countByCategory(records, ["staff costs"]),
        },
        {
          box: "Box 22",
          label: "Phone, stationery and office costs",
          amountPence: sumByCategory(records, ["office costs"]),
          count: countByCategory(records, ["office costs"]),
        },
        {
          box: "Box 23",
          label: "Advertising and marketing costs",
          amountPence: sumByCategory(records, ["advertising and marketing"]),
          count: countByCategory(records, ["advertising and marketing"]),
        },
        {
          box: "Box 26",
          label: "Accountancy, legal and professional fees",
          amountPence: sumByCategory(records, ["professional fees"]),
          count: countByCategory(records, ["professional fees"]),
        },
        {
          box: "Box 27",
          label: "Subcontractor costs",
          amountPence: sumByCategory(records, ["subcontractor costs"]),
          count: countByCategory(records, ["subcontractor costs"]),
        },
        {
          box: "Box 30",
          label: "Other allowable business expenses",
          amountPence: sumByCategory(records, ["other allowable expenses"]),
          count: countByCategory(records, ["other allowable expenses"]),
        },
      ].filter((b) => b.amountPence > 0 || b.count > 0),
    });

    outputContent = handover.coverLetterText;
  } else if (format === "txt") {
    contentType = "text/plain; charset=utf-8";
    outputContent = `Draft — not submitted to HMRC\nTax Prep Summary for ${getTaxYearLabel(taxYearStart)}\n`;
    outputContent += `=================================================\n\n`;
    outputContent += `Estimate and review pack only. This is not tax advice, not a filing calculation, and not a tax return submission.\n`;
    outputContent += `Review with the user or accountant before using any figure.\n\n`;

    outputContent += `Total Income: ${formatPounds(checklist.incomeTotal)}\n`;
    outputContent += `Total Expenses: ${formatPounds(checklist.expenseTotal)}\n`;
    outputContent += `Net Profit: ${formatPounds(checklist.profitTotal)}\n\n`;

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
        "Draft — not submitted to HMRC",
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

  const { error: exportError } = await supabase.from("record_exports").insert({
    user_id: user.id,
    export_type: "accountant_pack",
    tax_year_start: taxYearStart,
    completed_at: new Date().toISOString(),
    record_count: checklist.incomeCount + checklist.expenseCount,
    attachment_count: 0,
  });

  if (exportError) {
    return NextResponse.json(
      { error: "Could not record export. Please try again." },
      { status: 500 },
    );
  }

  const filename =
    format === "handover"
      ? `vibecount-accountant-handover-${getTaxYearLabel(taxYearStart)}.txt`
      : `vibecount-tax-prep-${getTaxYearLabel(taxYearStart)}.${format}`;

  return new NextResponse(outputContent, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
