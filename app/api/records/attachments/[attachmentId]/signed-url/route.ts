import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ attachmentId: string }>;
};

type AttachmentRow = {
  bucket_id: string;
  object_path: string;
  original_filename: string;
  status: string;
};

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to open attachments." }, { status: 401 });
  }

  const { attachmentId } = await params;

  const { data: attachment, error } = await supabase
    .from("record_attachments")
    .select("bucket_id, object_path, original_filename, status")
    .eq("id", attachmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Could not check this attachment." },
      { status: 500 }
    );
  }

  const row = attachment as AttachmentRow | null;

  if (!row || row.status !== "active") {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(row.bucket_id)
    .createSignedUrl(row.object_path, 60 * 5, {
      download: row.original_filename,
    });

  if (signedUrlError || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Could not create a secure attachment link." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    expiresInSeconds: 60 * 5,
  });
}
