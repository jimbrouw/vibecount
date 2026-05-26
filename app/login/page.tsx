"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f5f0e8] p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#1a3a2a] text-center mb-1">
          VibeCount
        </h1>
        <p className="text-center text-[#4a6a5a] text-sm mb-8">
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-8 space-y-5">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-[#1a3a2a]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#d5d0c8] px-4 py-2.5 text-[#1a3a2a] placeholder:text-[#a0a89e] focus:border-[#2d6a4a] focus:outline-none focus:ring-2 focus:ring-[#2d6a4a]/20"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-[#1a3a2a]">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#d5d0c8] px-4 py-2.5 text-[#1a3a2a] placeholder:text-[#a0a89e] focus:border-[#2d6a4a] focus:outline-none focus:ring-2 focus:ring-[#2d6a4a]/20"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#1a3a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2d6a4a] disabled:opacity-60 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-[#4a6a5a] mt-6">
          No account?{" "}
          <Link href="/signup" className="font-medium text-[#1a3a2a] underline underline-offset-2">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
