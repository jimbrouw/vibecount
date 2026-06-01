import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/records/import/[id]/reject">) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to reject imports." }, { status: 401 });
  }

  const { id } = await ctx.params;

  const { data, error } = await supabase
    .from("record_imports")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "approved") // cannot reject an already-approved row
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not reject the import row." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, status: data.status });
}
