import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f5f0e8] p-8">
      <div className="w-full max-w-md rounded-2xl border border-[#e5e0d8] bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-[#2d6a4a]" />
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[#1a3a2a]">VibeCount</h1>
          <p className="text-[#4a6a5a]">Simple invoice drafting for freelancers.</p>
          <p className="text-sm leading-6 text-[#6a7c72]">
            Type it or speak it, check the read-back, then download the PDF.
          </p>
        </div>
        <div className="my-6 h-px bg-[#e5e0d8]" />
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
