"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  label: string;
  testId?: string;
};

export default function GoogleAuthButton({ label, testId }: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError("Google sign in could not start. Check the Google auth settings.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        data-testid={testId}
        onClick={signInWithGoogle}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#d5d0c8] bg-white px-4 py-2.5 text-sm font-medium text-[#1a3a2a] transition-colors hover:bg-[#f8f5ef] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#4285f4]"
        >
          G
        </span>
        {loading ? "Opening Google..." : label}
      </button>
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
