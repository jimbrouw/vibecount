import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./LogoutButton";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f5f0e8]">
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e5e0d8]">
        <h1 className="text-lg font-semibold text-[#1a3a2a]">VibeCount</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[#4a6a5a]">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="rounded-2xl bg-white p-10 shadow-sm text-center max-w-sm w-full">
          <p className="text-[#1a3a2a] font-medium">You&apos;re in.</p>
          <p className="mt-2 text-sm text-[#4a6a5a]">
            Invoices and the glossary are coming in the next steps.
          </p>
        </div>
      </div>
    </main>
  );
}
