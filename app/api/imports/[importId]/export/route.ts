import {
  identityManifest,
  type IdentityEvent,
} from "@/lib/records/duplicate-export";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { bankEvidenceLedger, bankEvidenceManifest, bankForeignDecisionLedger, FOREIGN_DECISION_LEDGER_SCHEMA, BANK_MANIFEST_SCHEMA, BANK_LEDGER_SCHEMA } from '@/lib/records/bank-dimensioned-export';
import { readBankExport } from '@/lib/records/bank-export-store';
import { escapeCsv } from "@/lib/records/export-csv";
import { readSourceFxProvenance } from '@/lib/records/fx-provenance-store';

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const db = await createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user)
    return NextResponse.json(
      { error: "Sign in to export sources." },
      { status: 401 },
    );
  const { importId } = await params;
  let before: string;
  try {
    before = await readFinancialStamp(() =>
      db.rpc("reconciliation_export_stamp"),
    );
  } catch {
    return NextResponse.json(
      { error: "Could not verify financial snapshot." },
      { status: 503 },
    );
  }
  const { data: source, error } = await db
    .from("record_imports")
    .select(
      "id,file_hash,parser_version,account_id,status,created_at,coverage_start,coverage_end",
    )
    .eq("id", importId)
    .eq("user_id", user.id)
    .not("source_file_id", "is", null)
    .maybeSingle();
  if (error || !source)
    return NextResponse.json(
      { error: "Preserved import not found." },
      { status: 404 },
    );
  const { data: account, error: accountError } = await db
    .from("financial_accounts")
    .select("label,masked_identifier")
    .eq("id", source.account_id)
    .eq("user_id", user.id)
    .single();
  if (accountError || !account)
    return NextResponse.json(
      { error: "Could not read account provenance." },
      { status: 500 },
    );
  const format = new URL(request.url).searchParams.get("format") ?? "ledger";
  if (!["ledger", "decisions", "manifest", "identities"].includes(format)) {
    return NextResponse.json(
      { error: "Choose ledger, decisions, manifest or identities format." },
      { status: 400 },
    );
  }
  const history = format === "decisions";
  const identities = format === "identities";
  const manifest = format === "manifest" || identities;
  try {
    let csv: string;
    let count: number;
    if (identities) {
      const events = await readAllExportRows<IdentityEvent>(async (after) => {
        let q = db
          .from("duplicate_history_events")
          .select(
            "id,decision_id,event_kind,transaction_id,verdict,rationale,subject_snapshot,retained_snapshot,cohort_snapshot,reviewed_stamp,author,created_at",
          )
          .eq("user_id", user.id)
          .or(`import_id.eq.${source.id},retained_import_id.eq.${source.id}`)
          .order("id")
          .limit(500);
        if (after) q = q.gt("id", after);
        const result = await q;
        return {
          data: result.data as unknown as IdentityEvent[] | null,
          error: result.error,
        };
      });
      csv = JSON.stringify(identityManifest(source.id, events), null, 2);
      count = events.length;
    } else if (history && source.parser_version==='mapped-csv/2') {
      const bank=await readBankExport(db,user.id,source.id),result=bankForeignDecisionLedger(bank.context);
      await bank.finish();csv=result.csv;count=result.count;
    } else if (history) {
      type Decision = {
        id: string;
        transaction_id: string;
        version: number;
        classification: string;
        business_use_bps: number;
        category_id: string | null;
        rationale: string;
        recognized_pence: number | string;
        author: string;
        created_at: string;
        evidence_status: string;
        merchant_batch_id: string | null;
        merchant_rule_version_id: string | null;
        merchant_origin: string | null;
        review_evidence_status: string | null;
        linked_documents: unknown;
        merchant_reversal_id: string | null;
      };
      const decisions = await readAllExportRows<Decision>(async (after) => {
        let q = db
          .from("merchant_decision_provenance")
          .select(
            "id,transaction_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author,created_at,evidence_status,merchant_batch_id,merchant_rule_version_id,merchant_origin,review_evidence_status,linked_documents,merchant_reversal_id",
          )
          .eq("user_id", user.id)
          .eq("import_id", source.id)
          .order("id")
          .limit(500);
        if (after) q = q.gt("id", after);
        const r = await q;
        return { data: r.data, error: r.error };
      });
      csv = [
        [
          "document_status",
          "file_sha256",
          "decision_id",
          "transaction_id",
          "version",
          "classification",
          "business_use_basis_points",
          "category_id",
          "rationale",
          "recognized_pence",
          "author",
          "created_at",
          "evidence_status",
          "merchant_batch_id",
          "merchant_rule_version_id",
          "merchant_origin",
          "review_evidence_status",
          "linked_documents",
          "merchant_reversal_id",
        ],
        ...decisions.map((d) => [
          "Draft — not submitted to HMRC",
          source.file_hash,
          d.id,
          d.transaction_id,
          String(d.version),
          d.classification,
          String(d.business_use_bps),
          d.category_id ?? "",
          d.rationale,
          String(d.recognized_pence),
          d.author,
          d.created_at,
          d.evidence_status,
          d.merchant_batch_id ?? "",
          d.merchant_rule_version_id ?? "",
          d.merchant_origin ?? "",
          d.review_evidence_status ?? "",
          JSON.stringify(d.linked_documents ?? []),
          d.merchant_reversal_id ?? "",
        ]),
      ]
        .map((r) => r.map(escapeCsv).join(","))
        .join("\r\n");
      count = decisions.length;
    } else {
      const bank = await readBankExport(db, user.id, source.id);
      csv = manifest
        ? JSON.stringify(bankEvidenceManifest(user.id, bank.context,
            await readSourceFxProvenance(db, user.id, bank.rows), {source,account}), null, 2)
        : bankEvidenceLedger(bank.context, bank.rows).csv;
      await bank.finish();
      count = bank.rows.length;
    }
    if (new TextEncoder().encode(csv).length > 4_000_000)
      throw new Error('Complete evidence export exceeds direct download capacity.');
    if (
      (await readFinancialStamp(() =>
        db.rpc("reconciliation_export_stamp"),
      )) !== before
    )
      throw new Error("Source decisions changed during export. Try again.");
    const { error: auditError } = await db.from("record_exports").insert({
      user_id: user.id,
      export_type: manifest ? "json" : "csv",
      record_count: count,
      attachment_count: 0,
      completed_at: new Date().toISOString(),
    });
    if (auditError) throw new Error("Could not record export.");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": manifest
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vibecount-${identities ? "identity-history" : manifest ? "evidence-manifest" : history ? "decisions" : "evidence-ledger"}-${source.id}.${manifest ? "json" : "csv"}"`,
        "Cache-Control": "private, no-store",
        ...(history&&source.parser_version==='mapped-csv/2'?{'X-VibeCount-Schema':FOREIGN_DECISION_LEDGER_SCHEMA}:{}),
        ...(format === 'manifest' ? { 'X-VibeCount-Schema': BANK_MANIFEST_SCHEMA } : format === 'ledger' ? { 'X-VibeCount-Schema': BANK_LEDGER_SCHEMA } : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not generate a complete evidence export." },
      { status: 500 },
    );
  }
}
