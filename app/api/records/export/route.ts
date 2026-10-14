import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RecordExportRow = {
  id: string;
  record_type: "income" | "expense";
  record_date: string;
  description: string;
  amount: string | number;
  source_type: string;
  document_date: string | null;
  payment_date: string | null;
  payment_status: string;
  currency: string;
  gross_pence: number | null;
  vat_pence: number | null;
  business_use_percent: number;
  expense_kind: string;
  refund_of: string | null;
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
    return NextResponse.json({ error: "Sign in to export records." }, { status: 401 });
  }

  const url = new URL(request.url);
  const taxYearStart = url.searchParams.get("taxYearStart");
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  let query = supabase
    .from("financial_records")
    .select(
      `
      id,
      record_type,
      record_date,
      description,
      amount,
      document_date, payment_date, payment_status, currency, gross_pence, vat_pence,
      business_use_percent, expense_kind, refund_of,
      source_type,
      source_reference,
      tax_year_start,
      tax_quarter,
      record_categories(name, sa103_box),
      record_attachments!record_attachments_record_same_user_fk(id, original_filename, content_type, size_bytes, status)
    `
    )
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("record_date", { ascending: true });

  if (taxYearStart) {
    query = query.eq("tax_year_start", Number(taxYearStart));
  }

  const { data: records, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Records export is not ready. Apply the secure records migration first." },
      { status: 500 }
    );
  }

  const rows = (records ?? []) as unknown as RecordExportRow[];
  const attachmentCount = rows.reduce(
    (count, record) =>
      count +
      record.record_attachments.filter((attachment) => attachment.status === "active")
        .length,
    0
  );

  await supabase.from("record_exports").insert({
    user_id: user.id,
    export_type: format,
    tax_year_start: taxYearStart ? Number(taxYearStart) : null,
    completed_at: new Date().toISOString(),
    record_count: rows.length,
    attachment_count: attachmentCount,
  });

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
      note: "This export is for record keeping and review. It is not an HMRC-recognised MTD software submission.",
      exportedAt: new Date().toISOString(),
      taxYearStart: taxYearStart ? Number(taxYearStart) : null,
      records: rows.map((record) => ({
        id: record.id,
        type: record.record_type,
        date: record.record_date,
        description: record.description,
        amount: Number(record.amount),
        documentDate: record.document_date,
        paymentDate: record.payment_date,
        paymentStatus: record.payment_status,
        currency: record.currency,
        grossPence: record.gross_pence,
        vatPence: record.vat_pence,
        businessUsePercent: record.business_use_percent,
        kind: record.expense_kind,
        refundOf: record.refund_of,
        reviewQuestions: receiptQuestions(record),
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
    }
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
    "attachment_count", "currency", "document_date", "payment_date", "payment_status",
    "gross_pence", "vat_pence", "business_use_percent", "kind", "refund_of", "evidence_ids", "review_questions",
  ];

  const rows = records.map((record) => [
    record.record_type,
    record.record_date,
    record.description,
    String(record.amount),
    record.record_categories?.name ?? "",
    record.record_categories?.sa103_box ?? "",
    record.source_type,
    record.source_reference ?? "",
    String(record.tax_year_start),
    String(record.tax_quarter),
    String(
      record.record_attachments.filter((attachment) => attachment.status === "active")
        .length
    ),
    record.currency, record.document_date ?? "", record.payment_date ?? "", record.payment_status,
    String(record.gross_pence ?? ""), String(record.vat_pence ?? ""), String(record.business_use_percent),
    record.expense_kind, record.refund_of ?? "", record.record_attachments.filter(a => a.status === "active").map(a => a.id).join("; "),
    receiptQuestions(record).join("; "),
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function receiptQuestions(record: RecordExportRow) {
  if (record.record_type !== "expense") return [];
  return [
    !record.record_attachments.some(a => a.status === "active") ? "Missing receipt evidence" : null,
    record.business_use_percent < 100 ? "Check private-use allocation" : null,
    record.vat_pence !== null ? "Review VAT treatment; costs include VAT" : "VAT amount unknown",
    record.payment_status === "unpaid" ? "Unpaid; outside paid expense totals" : null,
    "Check category and equipment treatment before tax use",
  ].filter((s): s is string => Boolean(s));
}

function escapeCsv(value: string) {
  if (/^[=+@-]/.test(value)) value = "'" + value;
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}
