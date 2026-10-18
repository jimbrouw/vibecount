import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTaxYearStart } from "@/lib/records/tax-periods";
import { readAllExportRows } from "@/lib/records/export-pages";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import { taxFactManifest } from "@/lib/tax/fact-export";
export async function GET(request: Request) {
  const db = await createClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json(
      { error: "Sign in to export tax facts." },
      { status: 401 },
    );
  const value = new URL(request.url).searchParams.get("year"),
    year = value === null ? getCurrentTaxYearStart() - 1 : Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    return NextResponse.json(
      { error: "Choose a supported tax-year start." },
      { status: 400 },
    );
  try {
    const stamp = await readFinancialStamp(() =>
      db.rpc("tax_review_stamp", { p_year: year }),
    );
    const read = (table: string, columns: string) =>
      readAllExportRows<Record<string, unknown> & { id: string }>(
        async (after) => {
          let q = db
            .from(table)
            .select(columns)
            .eq("user_id", user.id)
            .eq("tax_year_start", year)
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
    // Profiles need all revisions, not only the current projection.
    const profiles = await read(
      "tax_profile_history",
      "id,profile_id,ordinal,state,schema_version,financial_stamp,data,rationale,author,created_at,request_id",
    );
    const facts = await read(
      "tax_fact_history",
      "id,family_id,ordinal,kind,label,state,schema_version,data,rationale,author,created_at,request_id",
    );
    const sources = await read(
      "tax_fact_source_history",
      "id,revision_id,document_id,transaction_id,record_id,snapshot",
    );
    const sections = await read(
      "tax_section_attestations",
      "id,kind,ordinal,verdict,fact_digest,rationale,author,created_at,request_id",
    );
    if (
      (await readFinancialStamp(() =>
        db.rpc("tax_review_stamp", { p_year: year }),
      )) !== stamp
    )
      throw new Error("Tax review changed.");
    const manifest = taxFactManifest(year, {
        profiles,
        facts,
        sources,
        sections,
      }),
      audit = await db.from("record_exports").insert({
        user_id: user.id,
        export_type: "json",
        tax_year_start: year,
        record_count: facts.length,
        attachment_count: sources.length,
        completed_at: new Date().toISOString(),
      });
    if (audit.error) throw audit.error;
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="vibecount-tax-facts-${year}-draft.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not export complete, consistent tax fact history." },
      { status: 503 },
    );
  }
}
