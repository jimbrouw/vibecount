import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to export backup." }, { status: 401 });
  }

  try {
    const [
      { data: settings },
      { data: clients },
      { data: invoices },
      { data: records },
      { data: reminders },
    ] = await Promise.all([
      supabase.from("user_settings").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("clients").select("*").eq("user_id", user.id),
      supabase.from("invoices").select("*").eq("user_id", user.id),
      supabase.from("financial_records").select("*").eq("user_id", user.id),
      supabase.from("invoice_reminders").select("*").eq("user_id", user.id),
    ]);

    const backupData = {
      exportedAt: new Date().toISOString(),
      user: { id: user.id, email: user.email },
      settings: settings || null,
      clients: clients || [],
      invoices: invoices || [],
      financialRecords: records || [],
      invoiceReminders: reminders || [],
    };

    const filename = `vibecount-full-backup-${new Date().toISOString().split("T")[0]}.json`;

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to generate backup." }, { status: 500 });
  }
}
