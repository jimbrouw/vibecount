import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveGlossaryTerms } from "@/lib/glossary";
import { AccessibilityProvider } from "./AccessibilityProvider";
import { GlossaryProvider, GlossaryTerm } from "./GlossaryProvider";
import DashboardShell from "./DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const [userResult, termsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("glossary_terms")
      .select("id, term, explanation, example")
      .order("sort_order", { ascending: true })
      .order("term", { ascending: true }),
  ]);

  if (!userResult.data.user) {
    redirect("/login");
  }

  const glossaryTerms: GlossaryTerm[] = resolveGlossaryTerms(
    (termsResult.data ?? []) as GlossaryTerm[]
  );

  return (
    <GlossaryProvider terms={glossaryTerms}>
      <AccessibilityProvider>
        <div className="dashboard-shell">
          <DashboardShell userEmail={userResult.data.user.email ?? ""}>
            {children}
          </DashboardShell>
        </div>
      </AccessibilityProvider>
    </GlossaryProvider>
  );
}
