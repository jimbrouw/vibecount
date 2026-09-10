import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ attachmentId: string }>;
};

type AttachmentRow = {
  id: string;
  bucket_id: string;
  object_path: string;
  status: string;
};

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to delete attachments." }, { status: 401 });
  }

  const { attachmentId } = await params;

  const { data: attachment, error } = await supabase
    .from("record_attachments")
    .select("id, bucket_id, object_path, status")
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

  const { error: storageError } = await supabase.storage
    .from(row.bucket_id)
    .remove([row.object_path]);

  if (storageError) {
    return NextResponse.json(
      { error: "Could not delete this attachment file." },
      { status: 500 }
    );
  }

  const { error: updateError } = await supabase
    .from("record_attachments")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json(
      { error: "The file was deleted, but attachment metadata was not updated." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deletedAttachmentId: row.id });
}
