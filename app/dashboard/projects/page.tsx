import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import LogoutButton from "@/app/dashboard/LogoutButton";
import { createProject, setProjectStatus, tagInvoiceToProject, tagRecordToProject } from "./actions";

export const metadata = {
  title: "Projects — VibeCount",
  description: "Track income and expenses by project.",
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  budget_pence: number | string;
  status: "active" | "completed" | "archived";
  clients: { name: string } | null;
};

type InvoiceOption = {
  id: string;
  number: string;
  amount: number | string;
  description: string;
  project_id: string | null;
  clients: { name: string } | null;
};

type RecordOption = {
  id: string;
  record_type: string;
  record_date: string;
  description: string;
  amount: number | string;
  project_id: string | null;
  record_categories: { name: string } | null;
};

type ProjectInvoice = {
  id: string;
  number: string;
  amount: number | string;
  description: string;
  status: string;
};

type ProjectRecord = {
  id: string;
  record_type: string;
  record_date: string;
  description: string;
  amount: number | string;
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const message = getPageMessage(params);

  const [projectsResult, invoicesResult, recordsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, budget_pence, status, clients(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, number, amount, description, project_id, status, clients(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("financial_records")
      .select("id, record_type, record_date, description, amount, project_id, record_categories(name)")
      .eq("user_id", user.id)
      .in("status", ["approved", "review"])
      .order("record_date", { ascending: false })
      .limit(50),
  ]);

  const projects = (projectsResult.data ?? []) as unknown as ProjectRow[];
  const allInvoices = (invoicesResult.data ?? []) as unknown as InvoiceOption[];
  const allRecords = (recordsResult.data ?? []) as unknown as RecordOption[];

  const untaggedInvoices = allInvoices.filter((i) => !i.project_id);
  const untaggedRecords = allRecords.filter((r) => !r.project_id);

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Invoices</Link>
            <Link href="/dashboard/records" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Records</Link>
            <Link href="/dashboard/quotes" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Quotes</Link>
            <Link href="/dashboard/proposals" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Proposals</Link>
            <Link href="/dashboard/contracts" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Contracts</Link>
            <Link href="/dashboard/projects" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">Projects</Link>
            <Link href="/dashboard/tax-prep" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Tax prep</Link>
            <Link href="/dashboard/review" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Review</Link>
            <Link href="/dashboard/settings" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4"><LogoutButton /></div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">Projects</h1>
          <p className="mt-1 text-sm text-[#166534]">
            Group invoices and records by project to see income, expenses, and budget at a glance.
          </p>
        </div>

        {message && (
          <p className={`mb-6 rounded-lg border px-4 py-3 text-sm ${message.kind === "error" ? "border-[#e0b4a7] bg-[#fff7f3] text-[#7a271a]" : "border-[#86efac] bg-[#dcfce7] text-[#14532d]"}`}>
            {message.text}
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
          {/* Create form */}
          <section className="rounded-xl border border-[#bbf7d0] bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-[#14532d]">New project</h2>
            <form action={createProject} className="space-y-4" data-testid="project-create-form">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Project name</span>
                <input name="name" data-testid="project-name-input" type="text" placeholder="Website redesign" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" required />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Client (optional)</span>
                <input name="clientName" type="text" placeholder="Acme Ltd" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Budget (£, optional)</span>
                <input name="budget" inputMode="decimal" placeholder="5000.00" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Description (optional)</span>
                <textarea name="description" rows={2} placeholder="Brief description…" className="mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <button type="submit" data-testid="project-save-button" className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#15803d] text-sm font-semibold text-white transition hover:bg-[#14532d]">
                Save project
              </button>
            </form>
          </section>

          {/* Project list */}
          <section className="space-y-4">
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-10 text-center">
                <p className="text-sm text-[#4b8068]">No projects yet.</p>
                <p className="mt-1 text-xs text-[#86a88e]">Create one on the left, then tag invoices and records to it.</p>
              </div>
            ) : (
              projects.map((project) => {
                const projectInvoices = allInvoices.filter((i) => i.project_id === project.id) as unknown as ProjectInvoice[];
                const projectRecords = allRecords.filter((r) => r.project_id === project.id) as unknown as ProjectRecord[];
                const invoicedPence = projectInvoices.reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0);
                const incomePence = projectRecords.filter((r) => r.record_type === "income").reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
                const expensePence = projectRecords.filter((r) => r.record_type === "expense").reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
                const budgetPence = Number(project.budget_pence);

                return (
                  <details key={project.id} className="group rounded-xl border border-[#bbf7d0] bg-white shadow-sm" data-testid={`project-row-${project.id}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[#14532d]">{project.name}</p>
                          <StatusBadge status={project.status} />
                        </div>
                        <p className="mt-1 text-xs text-[#4b8068]">
                          {(project.clients as { name?: string } | null)?.name ?? "No client"}
                          {budgetPence > 0 ? ` · Budget: ${formatPounds(budgetPence)}` : ""}
                          {` · ${projectInvoices.length} invoice${projectInvoices.length === 1 ? "" : "s"} · ${projectRecords.length} record${projectRecords.length === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-[#14532d]">{formatPounds(invoicedPence)}</p>
                        <p className="mt-0.5 text-xs text-[#4b8068]">invoiced</p>
                      </div>
                    </summary>

                    <div className="border-t border-[#f0fdf4] bg-[#f7fef9] px-5 py-4 space-y-5">
                      {/* Summary */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-[#dcfce7] bg-white p-3 text-center">
                          <p className="text-xs text-[#4b8068]">Invoiced</p>
                          <p className="mt-0.5 text-sm font-semibold text-[#14532d]">{formatPounds(invoicedPence)}</p>
                        </div>
                        <div className="rounded-lg border border-[#dcfce7] bg-white p-3 text-center">
                          <p className="text-xs text-[#4b8068]">Income rec.</p>
                          <p className="mt-0.5 text-sm font-semibold text-[#14532d]">{formatPounds(incomePence)}</p>
                        </div>
                        <div className="rounded-lg border border-[#dcfce7] bg-white p-3 text-center">
                          <p className="text-xs text-[#4b8068]">Expenses</p>
                          <p className="mt-0.5 text-sm font-semibold text-[#14532d]">{formatPounds(expensePence)}</p>
                        </div>
                      </div>

                      {budgetPence > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-[#4b8068] mb-1">
                            <span>Budget used: {formatPounds(expensePence)} of {formatPounds(budgetPence)}</span>
                            <span>{Math.min(100, Math.round((expensePence / budgetPence) * 100))}%</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-[#dcfce7]">
                            <div
                              className={`h-2 rounded-full transition-all ${expensePence > budgetPence ? "bg-[#ef4444]" : "bg-[#15803d]"}`}
                              style={{ width: `${Math.min(100, (expensePence / budgetPence) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Tag invoices */}
                      {untaggedInvoices.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#166534]">Tag an invoice</p>
                          <form action={tagInvoiceToProject} className="flex gap-2" data-testid={`tag-invoice-form-${project.id}`}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <select name="invoiceId" data-testid={`tag-invoice-select-${project.id}`} className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs text-[#14532d]">
                              {untaggedInvoices.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.number} — {(i.clients as { name?: string } | null)?.name ?? "Client"} — {formatPounds(Math.round(Number(i.amount) * 100))}
                                </option>
                              ))}
                            </select>
                            <button type="submit" data-testid={`tag-invoice-button-${project.id}`} className={smallBtn}>Add</button>
                          </form>
                        </div>
                      )}

                      {/* Tag records */}
                      {untaggedRecords.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#166534]">Tag a record</p>
                          <form action={tagRecordToProject} className="flex gap-2" data-testid={`tag-record-form-${project.id}`}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <select name="recordId" data-testid={`tag-record-select-${project.id}`} className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs text-[#14532d]">
                              {untaggedRecords.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.record_date} · {r.record_type} · {r.description.slice(0, 40)} · {formatPounds(Math.round(Number(r.amount) * 100))}
                                </option>
                              ))}
                            </select>
                            <button type="submit" data-testid={`tag-record-button-${project.id}`} className={smallBtn}>Add</button>
                          </form>
                        </div>
                      )}

                      {/* Status actions */}
                      <div className="flex gap-2 pt-1">
                        {project.status === "active" && (
                          <form action={setProjectStatus}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" className={outlineBtn}>Mark complete</button>
                          </form>
                        )}
                        {project.status !== "archived" && (
                          <form action={setProjectStatus}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="status" value="archived" />
                            <button type="submit" className={outlineBtn}>Archive</button>
                          </form>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:    "bg-[#dcfce7] text-[#15803d]",
    completed: "bg-[#dbeafe] text-[#1d4ed8]",
    archived:  "bg-[#f0fdf4] text-[#4b8068]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] ?? styles.active}`}>
      {status}
    </span>
  );
}

function getPageMessage(params: Record<string, string | string[] | undefined>) {
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  if (error) return { kind: "error" as const, text: error };
  if (params.created) return { kind: "success" as const, text: "Project created." };
  if (params.updated) return { kind: "success" as const, text: "Project updated." };
  if (params.tagged) return { kind: "success" as const, text: "Item tagged to project." };
  return null;
}

const smallBtn = "inline-flex h-9 items-center rounded-lg bg-[#15803d] px-3 text-xs font-semibold text-white transition hover:bg-[#14532d]";
const outlineBtn = "inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";
