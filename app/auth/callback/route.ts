import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function redirectToLoginWithMessage(origin: string, message: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.warn("Supabase auth callback exchange failed", {
      message: error.message,
      status: error.status,
    });
    return redirectToLoginWithMessage(
      origin,
      "Could not confirm your account. The confirmation link may have expired or already been used."
    );
  }

  if (authError) {
    console.warn("Supabase auth callback returned without a code", {
      authError,
    });
  }

  return redirectToLoginWithMessage(
    origin,
    "Could not confirm your account. Please try signing in or request a new confirmation email."
  );
}
