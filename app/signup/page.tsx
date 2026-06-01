"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import GoogleAuthButton from "@/app/auth/GoogleAuthButton";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError("Account setup did not go through. Check the details and try again.");
      setLoading(false);
      return;
    }

    // If email confirmation is required, data.session will be null
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setMessage("Check your email. Your confirmation link is ready.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f0fdf4] p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#14532d] text-center mb-1">
          VibeCount
        </h1>
        <p className="text-center text-[#166534] text-sm mb-8">
          Create your account
        </p>

        <div className="bg-white rounded-2xl shadow-sm p-8 space-y-5 border border-[#bbf7d0]">
          <GoogleAuthButton label="Continue with Google" testId="signup-google-button" />

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#bbf7d0]" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-[#4b8068]">
              or
            </span>
            <div className="h-px flex-1 bg-[#bbf7d0]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="signup-form">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm text-[#15803d] bg-[#dcfce7] rounded-lg px-4 py-3">
              {message}
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-[#14532d]">
              Email
            </label>
            <input
              id="email"
              data-testid="signup-email-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#bbf7d0] px-4 py-2.5 text-[#14532d] placeholder:text-[#86a88e] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#16a34a]/20"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-[#14532d]">
              Password
            </label>
            <input
              id="password"
              data-testid="signup-password-input"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#bbf7d0] px-4 py-2.5 text-[#14532d] placeholder:text-[#86a88e] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#16a34a]/20"
              placeholder="At least 6 characters"
            />
          </div>

          <button
            type="submit"
            data-testid="signup-submit-button"
            disabled={loading}
            className="w-full rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#14532d] disabled:opacity-60 transition-colors"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
          </form>
        </div>

        <p className="text-center text-sm text-[#166534] mt-6">
          Already have an account?{" "}
          <Link
            href="/login"
            data-testid="signup-sign-in-link"
            className="font-medium text-[#14532d] underline underline-offset-2"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
