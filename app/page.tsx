import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f0fdf4] p-8">
      <div className="w-full max-w-md rounded-2xl border border-[#bbf7d0] bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-[#15803d]" />
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[#14532d]">VibeCount</h1>
          <p className="text-[#166534]">Simple invoice drafting for freelancers.</p>
          <p className="text-sm leading-6 text-[#4b8068]">
            Type it or speak it, check the read-back, then download the PDF.
          </p>
        </div>
        <div className="my-6 h-px bg-[#bbf7d0]" />
        <div className="flex flex-col gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#14532d] transition-colors"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-[#bbf7d0] px-4 py-2.5 text-sm font-medium text-[#14532d] hover:bg-[#f0fdf4] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
