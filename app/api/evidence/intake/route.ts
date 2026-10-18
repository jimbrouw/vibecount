import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DOCUMENT_PURPOSES,
  type DocumentPurpose,
  readDocumentBody,
  prepareDocumentIntake,
} from "@/lib/records/document-intake";
import { storeDocumentIntake } from "@/lib/records/document-store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json(
      { error: "Sign in to preserve evidence." },
      { status: 401 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Upload evidence from VibeCount." },
      { status: 403 },
    );
  let files;
  let year: number;
  let purpose: DocumentPurpose;
  try {
    const bytes = await readDocumentBody(request);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: bytes,
    }).formData();
    const file = form.get("document");
    purpose = String(form.get("purpose")) as DocumentPurpose;
    year = Number(form.get("taxYearStart"));
    if (
      !(file instanceof File) ||
      !DOCUMENT_PURPOSES.includes(purpose) ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100 ||
      form.get("preserveConfirmed") !== "yes"
    )
      throw new Error(
        "Choose a document, purpose and tax year, then confirm preservation.",
      );
    files = await prepareDocumentIntake(
      file.name,
      Buffer.from(await file.arrayBuffer()),
      purpose,
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not validate this upload. Use a PDF, PNG or JPEG up to 3 MB, or an invoice ZIP with at most 100 entries and 10 MB expanded. Unsafe, encrypted, damaged or unsupported archive members are rejected.",
      },
      { status: 400 },
    );
  }
  try {
    const result = await storeDocumentIntake(user.id, files, year, purpose);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not preserve the complete evidence upload. No financial entries were created. Check secure storage configuration before retrying.",
      },
      { status: 500 },
    );
  }
}
