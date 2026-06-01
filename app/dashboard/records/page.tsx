import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "../DashboardShell";
import RecordsDashboard from "./RecordsDashboard";

export const metadata = {
  title: "Records — VibeCount",
  description: "Log income and expenses, track your net profit, and prepare for Making Tax Digital.",
};

export default async function RecordsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="records" userEmail={user.email ?? ""}>
      <RecordsDashboard />
    </DashboardShell>
  );
}
