import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ creditId: string }> },
) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to read credit evidence." },
      { status: 401 },
    );
  const { creditId } = await params;
  const { data: credit, error } = await db
    .from("invoice_credit_notes")
    .select("pdf_path")
    .eq("id", creditId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !credit)
    return NextResponse.json({ error: "Credit not found." }, { status: 404 });
  const { data, error: linkError } = await db.storage
    .from("invoices")
    .createSignedUrl(credit.pdf_path, 300, {
      download: `credit-${creditId}.pdf`,
    });
  if (linkError || !data?.signedUrl)
    return NextResponse.json(
      { error: "Preserved credit PDF is unavailable." },
      { status: 503 },
    );
  return NextResponse.redirect(data.signedUrl);
}
