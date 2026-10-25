import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensureRecordCategories } from "@/lib/records/categories";
import { financeScenario } from "@/lib/finance/coverage";
import type { PlanRevision } from "@/lib/finance/server";
import type { ClusterableTransaction } from "@/lib/records/merchant-clusters";
import CheckInWizard from "./CheckInWizard";
import LogoutButton from "../LogoutButton";

export const metadata = {
  title: "10-Minute Friday Check-In — VibeCount",
  description:
    "A calming, guided 4-step check-in to keep your accounts, cash flow, and tax reserves up to date.",
};

export default async function CheckInPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const [
    categories,
    { data: importsData },
    { data: unreviewedTxData },
    { data: openInvoicesData },
    { data: currentPlanData },
    { data: unpaidBalancesData },
  ] = await Promise.all([
    ensureRecordCategories(supabase, user.id),
    supabase
      .from("record_imports")
      .select("id,original_filename,created_at,coverage_start,coverage_end")
      .eq("user_id", user.id)
      .not("source_file_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("refund_source_transactions")
      .select(
        "id,import_id,transaction_date,signed_amount_pence,currency,description,reference,classification,decision_version,business_use_bps,category_id,dedupe_status,source_row_id",
      )
      .eq("user_id", user.id)
      .eq("classification", "Unknown")
      .order("transaction_date", { ascending: false })
      .limit(500),
    supabase
      .from("invoices")
      .select("id,number,amount,due_date,clients(name)")
      .eq("user_id", user.id)
      .eq("status", "finalised")
      .is("paid_at", null)
      .order("invoice_date", { ascending: false })
      .limit(20),
    supabase
      .from("finance_plan_revisions")
      .select("*")
      .eq("user_id", user.id)
      .order("ordinal", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoice_payment_balances")
      .select("outstanding_pence")
      .eq("user_id", user.id)
      .gt("outstanding_pence", 0),
  ]);

  const latestPlan = currentPlanData as PlanRevision | null;
  const scenario = latestPlan ? financeScenario(latestPlan.result) : null;
  const unpaidInvoicesPence = (unpaidBalancesData ?? []).reduce(
    (sum, r) => sum + (Number(r.outstanding_pence) || 0),
    0,
  );

  const formattedInvoices = (openInvoicesData ?? []).map((inv) => ({
    id: inv.id,
    number: inv.number,
    amount: inv.amount,
    due_date: inv.due_date,
    client_name: Array.isArray((inv as any).clients)
      ? ((inv as any).clients[0]?.name ?? "Client")
      : ((inv as any).clients?.name ?? "Client"),
  }));

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            VibeCount
          </Link>
          <span className="hidden rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white sm:inline-block">
            10-Minute Check-In
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium text-white/80 hover:text-white"
          >
            ← Exit to Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-[#14532d]">
            The 10-Minute Friday Check-In
          </h1>
          <p className="mt-1 text-sm text-[#166534]">
            A guided 4-step routine to sort payments, match invoices, and know your Safe Cash.
          </p>
        </div>

        <CheckInWizard
          unreviewedTransactions={(unreviewedTxData ?? []) as ClusterableTransaction[]}
          categories={categories}
          recentImports={importsData ?? []}
          unpaidInvoices={formattedInvoices}
          cashBucketProps={{
            actualCashPence: scenario?.actual_cash_pence ?? null,
            liabilitiesPence: scenario?.liabilities_pence ?? null,
            actualTaxReservePence: scenario?.actual_tax_reserve_pence ?? null,
            requiredTaxProtectionPence: scenario?.required_tax_protection_pence ?? null,
            currentFreeCashPence: scenario?.current_free_cash_pence ?? null,
            monthlyCostsPence: latestPlan?.input.plan.forecast.monthly_costs_pence ?? null,
            monthlyDrawingsPence: latestPlan?.input.plan.forecast.monthly_drawings_pence ?? null,
            unpaidInvoicesPence,
          }}
        />
      </div>
    </main>
  );
}
