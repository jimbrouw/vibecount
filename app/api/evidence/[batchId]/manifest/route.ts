import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import {
  documentManifest,
  type DocumentManifestItem,
} from "@/lib/records/document-manifest";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const db = await createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user)
    return NextResponse.json(
      { error: "Sign in to export document evidence." },
      { status: 401 },
    );
  const { batchId } = await params;
  const { data: batch, error } = await db
    .from("document_batches")
    .select(
      "id,root_document_id,tax_year_start,purpose,parser_version,created_at",
    )
    .eq("id", batchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !batch)
    return NextResponse.json(
      { error: "Document evidence not found." },
      { status: 404 },
    );
  try {
    const items = await readAllExportRows<DocumentManifestItem>(
      async (after) => {
        let query = db
          .from("document_batch_items")
          .select(
            "id,ordinal,document_id,document:evidence_documents(id,file_hash,media_type,size_bytes)",
          )
          .eq("user_id", user.id)
          .eq("batch_id", batch.id)
          .order("id")
          .limit(100);
        if (after) query = query.gt("id", after);
        const result = await query;
        return {
          data: result.data as unknown as DocumentManifestItem[] | null,
          error: result.error,
        };
      },
    );
    const manifest = documentManifest(batch, items);
    const { error: auditError } = await db
      .from("record_exports")
      .insert({
        user_id: user.id,
        export_type: "json",
        record_count: 0,
        attachment_count: items.length,
        tax_year_start: batch.tax_year_start,
        completed_at: new Date().toISOString(),
      });
    if (auditError) throw new Error("Could not record export.");
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="vibecount-document-evidence-${batch.id}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not export complete document provenance." },
      { status: 500 },
    );
  }
}
