"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import GoogleAuthButton from "@/app/auth/GoogleAuthButton";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Something looks wrong. Check your email and password.");
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f0fdf4] p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#14532d] text-center mb-1">
          VibeCount
        </h1>
        <p className="text-center text-[#166534] text-sm mb-8">
          Sign in to your account
        </p>

        <div className="bg-white rounded-2xl shadow-sm p-8 space-y-5 border border-[#bbf7d0]">
          <GoogleAuthButton label="Sign in with Google" testId="login-google-button" />

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#bbf7d0]" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-[#4b8068]">
              or
            </span>
            <div className="h-px flex-1 bg-[#bbf7d0]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-[#14532d]">
              Email
            </label>
            <input
              id="email"
              data-testid="login-email-input"
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
              data-testid="login-password-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#bbf7d0] px-4 py-2.5 text-[#14532d] placeholder:text-[#86a88e] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#16a34a]/20"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            data-testid="login-submit-button"
            disabled={loading}
            className="w-full rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#14532d] disabled:opacity-60 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
          </form>
        </div>

        <p className="text-center text-sm text-[#166534] mt-6">
          No account?{" "}
          <Link
            href="/signup"
            data-testid="login-create-account-link"
            className="font-medium text-[#14532d] underline underline-offset-2"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
