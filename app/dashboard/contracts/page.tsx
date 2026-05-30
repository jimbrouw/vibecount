import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import LogoutButton from "@/app/dashboard/LogoutButton";
import { setContractStatus } from "./actions";

export const metadata = {
  title: "Contracts — VibeCount",
  description: "Contracts generated from accepted proposals.",
};

type ContractRow = {
  id: string;
  number: string;
  contract_date: string;
  title: string;
  status: "draft" | "sent" | "signed";
  total_pence: number | string;
  payment_terms: string;
  timeline_start: string | null;
  timeline_end: string | null;
  clients: { name: string } | null;
  proposals: { number: string } | null;
};

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const message = getPageMessage(params);

  const { data: contracts } = await supabase
    .from("contracts")
    .select("id, number, contract_date, title, status, total_pence, payment_terms, timeline_start, timeline_end, clients(name), proposals(number)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = (contracts ?? []) as unknown as ContractRow[];

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
            <Link href="/dashboard/contracts" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">Contracts</Link>
            <Link href="/dashboard/invoices/repeating" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Repeating</Link>
            <Link href="/dashboard/tax-prep" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Tax prep</Link>
            <Link href="/dashboard/review" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Review</Link>
            <Link href="/dashboard/settings" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">Contracts</h1>
            <p className="mt-1 text-sm text-[#166534]">
              Generated from accepted proposals. Download, mark sent, then mark signed when the client returns it.
            </p>
          </div>
          <Link href="/dashboard/proposals" className="inline-flex h-10 items-center rounded-xl border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]">
            Proposals
          </Link>
        </div>

        {message && (
          <p className={`mb-6 rounded-lg border px-4 py-3 text-sm ${message.kind === "error" ? "border-[#e0b4a7] bg-[#fff7f3] text-[#7a271a]" : "border-[#86efac] bg-[#dcfce7] text-[#14532d]"}`}>
            {message.text}
          </p>
        )}

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-12 text-center">
            <p className="text-sm text-[#4b8068]">No contracts yet.</p>
            <p className="mt-1 text-xs text-[#86a88e]">
              Mark a proposal as accepted, then choose Generate contract.
            </p>
            <Link href="/dashboard/proposals" className="mt-3 inline-block text-xs font-semibold text-[#15803d] underline">
              Go to Proposals
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((c) => (
              <details key={c.id} className="group rounded-xl border border-[#bbf7d0] bg-white shadow-sm" data-testid={`contract-row-${c.id}`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#14532d]">{c.title}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 text-xs text-[#4b8068]">
                      {c.number} · {(c.clients as { name?: string } | null)?.name ?? "Client"} · {formatDate(c.contract_date)}
                      {c.proposals ? ` · from ${(c.proposals as { number?: string } | null)?.number}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#14532d]">{formatPounds(Number(c.total_pence))}</p>
                    <p className="mt-0.5 text-xs text-[#4b8068]">Actions</p>
                  </div>
                </summary>

                <div className="border-t border-[#f0fdf4] bg-[#f7fef9] px-5 py-4">
                  {(c.timeline_start || c.timeline_end) && (
                    <p className="mb-3 text-xs text-[#4b8068]">
                      <span className="font-semibold text-[#166534]">Timeline: </span>
                      {[c.timeline_start ? formatDate(c.timeline_start) : null, c.timeline_end ? formatDate(c.timeline_end) : null].filter(Boolean).join(" – ")}
                    </p>
                  )}
                  <p className="mb-4 text-xs text-[#4b8068]">
                    <span className="font-semibold text-[#166534]">Payment: </span>{c.payment_terms}
                  </p>

                  <p className="mb-3 text-xs text-[#854d0e]">
                    This is a draft contract. Review all details and seek legal advice before sending to the client.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/contracts/pdf?id=${c.id}`}
                      data-testid={`contract-pdf-link-${c.id}`}
                      className="inline-flex h-9 items-center rounded-lg bg-[#15803d] px-4 text-xs font-semibold text-white transition hover:bg-[#14532d]"
                    >
                      Download PDF
                    </a>

                    {c.status === "draft" && (
                      <form action={setContractStatus}>
                        <input type="hidden" name="contractId" value={c.id} />
                        <input type="hidden" name="status" value="sent" />
                        <button type="submit" data-testid={`contract-mark-sent-${c.id}`} className={outlineBtn}>Mark sent</button>
                      </form>
                    )}

                    {c.status === "sent" && (
                      <form action={setContractStatus}>
                        <input type="hidden" name="contractId" value={c.id} />
                        <input type="hidden" name="status" value="signed" />
                        <button type="submit" data-testid={`contract-mark-signed-${c.id}`} className={outlineBtn}>Mark signed</button>
                      </form>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:  "bg-[#f0fdf4] text-[#4b8068]",
    sent:   "bg-[#dbeafe] text-[#1d4ed8]",
    signed: "bg-[#dcfce7] text-[#15803d]",
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
  if (params.created) return { kind: "success" as const, text: "Contract created." };
  if (params.updated) return { kind: "success" as const, text: "Contract updated." };
  return null;
}

const outlineBtn = "inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";
