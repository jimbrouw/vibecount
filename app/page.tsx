import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f5f0e8] p-8">
      <div className="rounded-2xl bg-white p-10 shadow-sm text-center max-w-sm w-full space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-[#1a3a2a] tracking-tight">VibeCount</h1>
          <p className="mt-2 text-[#4a6a5a]">Invoices for freelancers who hate invoices.</p>
        </div>
        <div className="h-px bg-[#e5e0d8]" />
        <div className="flex flex-col gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-[#1a3a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2d6a4a] transition-colors"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-[#d5d0c8] px-4 py-2.5 text-sm font-medium text-[#1a3a2a] hover:bg-[#f0ece4] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
