import {
  readConsistentReconciliation,
  readFinancialStamp,
} from "@/lib/records/consistent-reconciliation";
import {
  type AccountingAmount,
  recordEffectDecimal,
  recordEffectPence,
} from "@/lib/records/accounting-effect";
import { readAllExportRows } from "@/lib/records/export-pages";
import { escapeCsv } from "@/lib/records/export-csv";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RecordExportRow = {
  id: string;
  record_type: "income" | "expense";
  record_date: string;
  description: string;
  amount: string | number;
  effect_sign: number;
  cash_effect_pence?: AccountingAmount["cash_effect_pence"];
  cash_treatment?: AccountingAmount["cash_treatment"];
  refund_link_id: string | null;
  source_type: string;
  source_reference: string | null;
  tax_year_start: number;
  tax_quarter: number;
  record_categories: { name: string; sa103_box: string | null } | null;
  record_attachments: {
    id: string;
    original_filename: string;
    content_type: string;
    size_bytes: number;
    status: string;
  }[];
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Sign in to export records." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const taxYearStart = url.searchParams.get("taxYearStart");
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  let rows: RecordExportRow[];
  try {
    rows = await readConsistentReconciliation(
      () =>
        readFinancialStamp(() => supabase.rpc("reconciliation_export_stamp")),
      () =>
        readAllExportRows<RecordExportRow>(async (afterId) => {
          let query = supabase
            .from("financial_records")
            .select(
              `
      id,
      record_type,
      record_date,
      description,
      amount,
      effect_sign,
      cash_effect_pence,
      cash_treatment,
      refund_link_id,
      source_type,
      source_reference,
      tax_year_start,
      tax_quarter,
      record_categories(name, sa103_box),
      record_attachments!record_attachments_record_same_user_fk(id, original_filename, content_type, size_bytes, status)
    `,
            )
            .eq("user_id", user.id)
            .eq("status", "approved")
            .order("id", { ascending: true })
            .limit(500);
          if (taxYearStart)
            query = query.eq("tax_year_start", Number(taxYearStart));
          if (afterId) query = query.gt("id", afterId);
          const result = await query;
          return {
            data: result.data as unknown as RecordExportRow[] | null,
            error: result.error,
          };
        }),
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read a complete records export." },
      { status: 500 },
    );
  }
  rows.sort(
    (a, b) =>
      a.record_date.localeCompare(b.record_date) || a.id.localeCompare(b.id),
  );
  const attachmentCount = rows.reduce(
    (count, record) =>
      count +
      record.record_attachments.filter(
        (attachment) => attachment.status === "active",
      ).length,
    0,
  );

  const { error: exportError } = await supabase.from("record_exports").insert({
    user_id: user.id,
    export_type: format,
    tax_year_start: taxYearStart ? Number(taxYearStart) : null,
    completed_at: new Date().toISOString(),
    record_count: rows.length,
    attachment_count: attachmentCount,
  });

  if (exportError) {
    return NextResponse.json(
      { error: "Could not record export. Please try again." },
      { status: 500 },
    );
  }

  const filename = `vibecount-mtd-ready-records${
    taxYearStart ? `-${taxYearStart}` : ""
  }.${format}`;

  if (format === "csv") {
    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(
    {
      label: "MTD-ready records export",
      note: "Amounts are signed recognised accounting effects; amountMagnitude preserves the positive magnitude. This export is for record keeping and review. It is not an HMRC-recognised MTD software submission.",
      exportedAt: new Date().toISOString(),
      taxYearStart: taxYearStart ? Number(taxYearStart) : null,
      records: rows.map((record) => ({
        id: record.id,
        type: record.record_type,
        date: record.record_date,
        description: record.description,
        amount: Number(recordEffectDecimal(record)),
        amountMagnitude: String(record.amount),
        recognizedPence: String(recordEffectPence(record)),
        effectSign: record.effect_sign,
        cashTreatment: record.cash_treatment,
        refundLinkId: record.refund_link_id,
        category: record.record_categories?.name ?? null,
        selfAssessmentHint: record.record_categories?.sa103_box ?? null,
        sourceType: record.source_type,
        sourceReference: record.source_reference,
        taxYearStart: record.tax_year_start,
        taxQuarter: record.tax_quarter,
        attachments: record.record_attachments
          .filter((attachment) => attachment.status === "active")
          .map((attachment) => ({
            id: attachment.id,
            filename: attachment.original_filename,
            contentType: attachment.content_type,
            sizeBytes: attachment.size_bytes,
          })),
      })),
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
  );
}

function toCsv(records: RecordExportRow[]) {
  const header = [
    "type",
    "date",
    "description",
    "amount",
    "category",
    "self_assessment_hint",
    "source_type",
    "source_reference",
    "tax_year_start",
    "tax_quarter",
    "attachment_count",
    "amount_magnitude",
    "effect_sign",
    "refund_link_id",
    "cash_treatment",
  ];

  const rows = records.map((record) => [
    record.record_type,
    record.record_date,
    record.description,
    recordEffectDecimal(record),
    record.record_categories?.name ?? "",
    record.record_categories?.sa103_box ?? "",
    record.source_type,
    record.source_reference ?? "",
    String(record.tax_year_start),
    String(record.tax_quarter),
    String(
      record.record_attachments.filter(
        (attachment) => attachment.status === "active",
      ).length,
    ),
    String(record.amount),
    String(record.effect_sign),
    record.refund_link_id ?? "",
    record.cash_treatment ?? "",
  ]);

  return [header, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
}
