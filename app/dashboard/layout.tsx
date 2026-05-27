import { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { AccessibilityProvider } from "./AccessibilityProvider";
import { GlossaryProvider, GlossaryTerm } from "./GlossaryProvider";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const { data: terms } = await supabase
    .from("glossary_terms")
    .select("id, term, explanation, example")
    .order("sort_order", { ascending: true })
    .order("term", { ascending: true });

  const glossaryTerms: GlossaryTerm[] = (terms ?? []) as GlossaryTerm[];

  return (
    <GlossaryProvider terms={glossaryTerms}>
      <AccessibilityProvider>
        <div className="dashboard-shell">{children}</div>
      </AccessibilityProvider>
    </GlossaryProvider>
  );
}
