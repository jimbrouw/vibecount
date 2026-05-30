import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import { DEFAULT_PAYMENT_TERMS } from "@/lib/invoices/validation";
import LogoutButton from "@/app/dashboard/LogoutButton";
import { createProposal, setProposalStatus, convertProposalToInvoice } from "./actions";

export const metadata = {
  title: "Proposals — VibeCount",
  description: "Create project proposals with scope, timeline, and pricing.",
};

type ServiceRow = { id: string; name: string; description: string; unit_price: string | number };
type ProposalRow = {
  id: string;
  number: string;
  proposal_date: string;
  valid_until: string | null;
  title: string;
  scope: string;
  deliverables: string;
  timeline_start: string | null;
  timeline_end: string | null;
  payment_terms: string;
  status: "draft" | "sent" | "accepted" | "declined";
  notes: string | null;
  clients: { name: string } | null;
  proposal_line_items: { description: string; quantity: string | number; unit_price: string | number }[];
};

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const message = getPageMessage(params);
  const today = new Date().toISOString().slice(0, 10);

  const [servicesResult, proposalsResult] = await Promise.all([
    supabase.from("services").select("id, name, description, unit_price").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase
      .from("proposals")
      .select("id, number, proposal_date, valid_until, title, scope, deliverables, timeline_start, timeline_end, payment_terms, status, notes, clients(name), proposal_line_items(description, quantity, unit_price)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const services = (servicesResult.data ?? []) as ServiceRow[];
  const proposals = (proposalsResult.data ?? []) as unknown as ProposalRow[];

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Invoices</Link>
            <Link href="/dashboard/records" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Records</Link>
            <Link href="/dashboard/quotes" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Quotes</Link>
            <Link href="/dashboard/proposals" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">Proposals</Link>
            <Link href="/dashboard/invoices/repeating" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Repeating</Link>
            <Link href="/dashboard/tax-prep" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Tax prep</Link>
            <Link href="/dashboard/review" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Review</Link>
            <Link href="/dashboard/glossary" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Explain Simply</Link>
            <Link href="/dashboard/settings" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">Proposals</h1>
          <p className="mt-1 text-sm text-[#166534]">
            Create a project proposal with scope, timeline, and pricing. Download a PDF to send to your client.
          </p>
        </div>

        {message && (
          <p className={`mb-6 rounded-lg border px-4 py-3 text-sm ${message.kind === "error" ? "border-[#e0b4a7] bg-[#fff7f3] text-[#7a271a]" : "border-[#86efac] bg-[#dcfce7] text-[#14532d]"}`}>
            {message.text}
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          {/* Create form */}
          <section className="rounded-xl border border-[#bbf7d0] bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-[#14532d]">New proposal</h2>
            <form action={createProposal} className="space-y-4" data-testid="proposal-create-form">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Client name</span>
                <input name="clientName" data-testid="proposal-client-name-input" type="text" placeholder="Acme Ltd" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" required />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Project title</span>
                <input name="title" data-testid="proposal-title-input" type="text" placeholder="Brand identity redesign" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" required />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Proposal date</span>
                  <input name="proposalDate" type="date" defaultValue={today} className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Valid until</span>
                  <input name="validUntil" type="date" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Project scope</span>
                <textarea name="scope" data-testid="proposal-scope-input" rows={3} placeholder="Describe the project and what's included…" className="mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Deliverables</span>
                <textarea name="deliverables" data-testid="proposal-deliverables-input" rows={2} placeholder="What the client will receive…" className="mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Timeline start</span>
                  <input name="timelineStart" type="date" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Timeline end</span>
                  <input name="timelineEnd" type="date" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
                </label>
              </div>
              <div className="rounded-lg border border-[#dcfce7] bg-[#f7fef9] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#166534]">Pricing</p>
                {services.length > 0 && (
                  <label className="mb-3 block">
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">From saved service</span>
                    <select name="serviceId" data-testid="proposal-service-select" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]">
                      <option value="">— or enter manually below —</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {formatPounds(Math.round(Number(s.unit_price) * 100))}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="mb-3 block">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Description</span>
                  <input name="description" data-testid="proposal-description-input" type="text" placeholder="Strategy and design" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" required />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Price (£)</span>
                    <input name="unitPrice" data-testid="proposal-price-input" inputMode="decimal" placeholder="2500.00" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" required />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Quantity</span>
                    <input name="quantity" type="number" min="1" step="1" defaultValue="1" className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
                  </label>
                </div>
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Payment terms</span>
                <input name="paymentTerms" type="text" defaultValue={DEFAULT_PAYMENT_TERMS} className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Notes (optional)</span>
                <textarea name="notes" rows={2} placeholder="Any additional terms or comments…" className="mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm text-[#14532d] outline-none focus:border-[#15803d]" />
              </label>
              <button type="submit" data-testid="proposal-save-button" className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#15803d] text-sm font-semibold text-white transition hover:bg-[#14532d]">
                Save proposal
              </button>
            </form>
          </section>

          {/* Proposals list */}
          <section>
            <h2 className="mb-4 text-base font-semibold text-[#14532d]">Your proposals</h2>
            {proposals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-10 text-center">
                <p className="text-sm text-[#4b8068]">No proposals yet.</p>
                <p className="mt-1 text-xs text-[#86a88e]">Create your first one on the left.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {proposals.map((p) => {
                  const total = (p.proposal_line_items ?? []).reduce(
                    (sum, item) => sum + Math.round(Number(item.quantity) * Number(item.unit_price) * 100),
                    0
                  );
                  return (
                    <details key={p.id} className="group rounded-xl border border-[#bbf7d0] bg-white shadow-sm" data-testid={`proposal-row-${p.id}`}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[#14532d]">{p.title}</p>
                            <StatusBadge status={p.status} />
                          </div>
                          <p className="mt-1 text-xs text-[#4b8068]">
                            {p.number} · {(p.clients as { name?: string } | null)?.name ?? "Client"} · {formatDate(p.proposal_date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[#14532d]">{formatPounds(total)}</p>
                          <p className="mt-0.5 text-xs text-[#4b8068]">Edit</p>
                        </div>
                      </summary>

                      <div className="border-t border-[#f0fdf4] bg-[#f7fef9] px-5 py-4">
                        {p.scope && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Scope</p>
                            <p className="mt-1 text-sm text-[#14532d]">{p.scope}</p>
                          </div>
                        )}
                        {p.deliverables && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Deliverables</p>
                            <p className="mt-1 text-sm text-[#14532d]">{p.deliverables}</p>
                          </div>
                        )}
                        {(p.timeline_start || p.timeline_end) && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Timeline</p>
                            <p className="mt-1 text-sm text-[#14532d]">
                              {[p.timeline_start ? formatDate(p.timeline_start) : null, p.timeline_end ? formatDate(p.timeline_end) : null].filter(Boolean).join(" – ")}
                            </p>
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <a
                            href={`/api/proposals/pdf?id=${p.id}`}
                            data-testid={`proposal-pdf-link-${p.id}`}
                            className="inline-flex h-9 items-center rounded-lg bg-[#15803d] px-4 text-xs font-semibold text-white transition hover:bg-[#14532d]"
                          >
                            Download PDF
                          </a>

                          {p.status === "draft" && (
                            <form action={setProposalStatus}>
                              <input type="hidden" name="proposalId" value={p.id} />
                              <input type="hidden" name="status" value="sent" />
                              <button type="submit" data-testid={`proposal-mark-sent-${p.id}`} className={outlineBtn}>Mark sent</button>
                            </form>
                          )}

                          {p.status === "sent" && (
                            <>
                              <form action={setProposalStatus}>
                                <input type="hidden" name="proposalId" value={p.id} />
                                <input type="hidden" name="status" value="accepted" />
                                <button type="submit" data-testid={`proposal-accept-${p.id}`} className={outlineBtn}>Mark accepted</button>
                              </form>
                              <form action={setProposalStatus}>
                                <input type="hidden" name="proposalId" value={p.id} />
                                <input type="hidden" name="status" value="declined" />
                                <button type="submit" data-testid={`proposal-decline-${p.id}`} className={outlineBtn}>Mark declined</button>
                              </form>
                            </>
                          )}

                          {p.status === "accepted" && (
                            <form action={convertProposalToInvoice} data-testid={`proposal-convert-form-${p.id}`}>
                              <input type="hidden" name="proposalId" value={p.id} />
                              <button type="submit" data-testid={`proposal-convert-button-${p.id}`} className="inline-flex h-9 items-center rounded-lg border border-[#15803d] bg-white px-4 text-xs font-semibold text-[#15803d] transition hover:bg-[#f0fdf4]">
                                Convert to invoice
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     "bg-[#f0fdf4] text-[#4b8068]",
    sent:      "bg-[#dbeafe] text-[#1d4ed8]",
    accepted:  "bg-[#dcfce7] text-[#15803d]",
    declined:  "bg-[#fee2e2] text-[#b91c1c]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

function getPageMessage(params: Record<string, string | string[] | undefined>) {
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  if (error) return { kind: "error" as const, text: error };
  if (params.created) return { kind: "success" as const, text: "Proposal saved." };
  if (params.updated) return { kind: "success" as const, text: "Proposal updated." };
  return null;
}

const outlineBtn = "inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";
