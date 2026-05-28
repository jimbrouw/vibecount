import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ recordId: string }>;
};

type AttachmentRow = {
  id: string;
  bucket_id: string;
  object_path: string;
};

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to delete records." }, { status: 401 });
  }

  const { recordId } = await params;

  const { data: record, error: recordError } = await supabase
    .from("financial_records")
    .select("id")
    .eq("id", recordId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (recordError) {
    return NextResponse.json(
      { error: "Could not check this record." },
      { status: 500 }
    );
  }

  if (!record) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  const { data: attachments } = await supabase
    .from("record_attachments")
    .select("id, bucket_id, object_path")
    .eq("record_id", recordId)
    .eq("user_id", user.id)
    .eq("status", "active");

  const attachmentRows = (attachments ?? []) as AttachmentRow[];
  const objectPaths = attachmentRows.map((attachment) => attachment.object_path);

  if (objectPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("record-attachments")
      .remove(objectPaths);

    if (storageError) {
      return NextResponse.json(
        { error: "Could not delete this record's attachments." },
        { status: 500 }
      );
    }

    const { error: attachmentError } = await supabase
      .from("record_attachments")
      .update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
      })
      .in(
        "id",
        attachmentRows.map((attachment) => attachment.id)
      )
      .eq("user_id", user.id);

    if (attachmentError) {
      return NextResponse.json(
        { error: "Attachments were deleted, but their record metadata was not updated." },
        { status: 500 }
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("financial_records")
    .delete()
    .eq("id", recordId)
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json({ error: "Could not delete this record." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deletedRecordId: recordId,
    deletedAttachmentCount: objectPaths.length,
  });
}
