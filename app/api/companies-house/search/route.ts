import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export type CHCompany = {
  name: string;
  company_number: string;
  address: string;
  status: string;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ companies: [] });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("companies_house_api_key")
    .eq("id", user.id)
    .maybeSingle();

  const apiKey = settings?.companies_house_api_key?.trim();
  if (!apiKey) return NextResponse.json({ companies: [], configured: false });

  try {
    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=6`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        return NextResponse.json({ error: "Invalid Companies House API key. Check Settings.", companies: [] }, { status: 200 });
      }
      return NextResponse.json({ companies: [] });
    }

    const data = await res.json() as {
      items?: {
        title: string;
        company_number: string;
        address_snippet?: string;
        company_status?: string;
      }[];
    };

    const companies: CHCompany[] = (data.items ?? [])
      .filter((item) => item.company_status === "active" || !item.company_status)
      .slice(0, 5)
      .map((item) => ({
        name: item.title,
        company_number: item.company_number,
        address: item.address_snippet ?? "",
        status: item.company_status ?? "",
      }));

    return NextResponse.json({ companies, configured: true });
  } catch {
    return NextResponse.json({ companies: [] });
  }
}
