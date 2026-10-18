import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import { merchantManifest } from "@/lib/records/merchant-export";
export async function GET() {
  const db = await createClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json(
      { error: "Sign in to export review history." },
      { status: 401 },
    );
  try {
    const before = await readFinancialStamp(() =>
      db.rpc("reconciliation_export_stamp"),
    );
    const read = (table: string, select: string) =>
      readAllExportRows<Record<string, unknown> & { id: string }>(
        async (after) => {
          let q = db
            .from(table)
            .select(select)
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as unknown as
              (Record<string, unknown> & { id: string })[] | null,
            error: r.error,
          };
        },
      );
    const rules = await read(
      "merchant_rules",
      "id,match_key,record_type,normalization_version,created_at",
    );
    const versions = await read(
      "merchant_rule_versions",
      "id,rule_id,ordinal,status,account_id,tax_year_start,effective_from,expires_on,priority,classification,business_use_bps,category_id,category_snapshot,evidence_status,seed_transaction_id,seed_snapshot,rationale,author,request_id,created_at",
    );
    const batches = await read(
      "merchant_review_batches",
      "id,reviewed_stamp,rationale,author,request_id,created_at",
    );
    const items = await read(
      "merchant_review_items",
      "id,batch_id,transaction_id,rule_version_id,origin,before_snapshot,after_version,classification,business_use_bps,category_id,category_snapshot,evidence_status,recognized_pence,rationale,created_at",
    );
    const evidence = await read(
      "merchant_review_evidence",
      "id,item_id,document_id,document_snapshot",
    );
    const reversals = await read(
      "merchant_review_reversals",
      "id,batch_id,reviewed_stamp,rationale,author,request_id,created_at",
    );
    const undo = await read(
      "merchant_review_undo_items",
      "id,reversal_id,item_id,transaction_id,after_version,before_snapshot",
    );
    const rollovers = await read("merchant_rule_rollovers", "id,source_rule_id,source_version_id,target_rule_id,target_version_id,target_tax_year_start,reviewed_stamp,rationale,author,request_id,created_at");
    if (
      (await readFinancialStamp(() =>
        db.rpc("reconciliation_export_stamp"),
      )) !== before
    )
      throw new Error("Review changed during export.");
    const manifest = merchantManifest({
      rules,
      versions,
      batches,
      items,
      evidence,
      reversals,
      undo,
      rollovers,
    });
    const audit = await db.from("record_exports").insert({
      user_id: user.id,
      export_type: "json",
      record_count: items.length,
      attachment_count: evidence.length,
      completed_at: new Date().toISOString(),
    });
    if (audit.error) throw audit.error;
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="vibecount-merchant-review-draft.json"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not generate complete, consistent review history." },
      { status: 503 },
    );
  }
}
