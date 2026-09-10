import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import { DEFAULT_PAYMENT_TERMS } from "@/lib/invoices/validation";
import LogoutButton from "../../LogoutButton";
import { createRepeatingTemplate, setRepeatingTemplateStatus } from "./actions";
import RunDueDraftsButton from "./RunDueDraftsButton";

export const metadata = {
  title: "Repeating Invoices — VibeCount",
  description: "Create draft invoices from repeating templates.",
};

type ClientRow = {
  id: string;
  name: string;
};

type TemplateRow = {
  id: string;
  title: string;
  description: string;
  amount: string | number;
  payment_terms: string;
  frequency: "monthly" | "quarterly" | "yearly";
  next_run_date: string;
  status: "active" | "paused";
  clients: { name: string } | null;
};

export default async function RepeatingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;
  const message = getPageMessage(params);
  const [clientsResult, templatesResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", user.id)
      .order("name", { ascending: true }),
    supabase
      .from("repeating_invoice_templates")
      .select("id, title, description, amount, payment_terms, frequency, next_run_date, status, clients(name)")
      .eq("user_id", user.id)
      .order("next_run_date", { ascending: true }),
  ]);

  const clients = (clientsResult.data ?? []) as ClientRow[];
  const templates = (templatesResult.data ?? []) as unknown as TemplateRow[];

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            VibeCount
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              Invoices
            </Link>
            <Link href="/dashboard/invoices/repeating" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">
              Repeating
            </Link>
            <Link href="/dashboard/quotes" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              Quotes
            </Link>
            <Link href="/dashboard/records" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              Records
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-white/80 sm:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
              Repeating invoice drafts
            </h1>
            <p className="mt-1 text-sm text-[#166534]">
              Create draft invoices on a schedule. Nothing is sent automatically.
            </p>
          </div>
          <RunDueDraftsButton />
        </div>

        {message && (
          <div className={`mb-6 rounded-xl border p-4 text-sm ${message.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-[#bbf7d0] bg-white text-[#14532d]"}`}>
            {message.text}
          </div>
        )}

        <section className="mb-6 rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#14532d]">New repeating template</h2>
          {clients.length === 0 ? (
            <p className="mt-3 text-sm text-[#4b8068]">
              Create a normal invoice or quote first so you have a saved client.
            </p>
          ) : (
            <form action={createRepeatingTemplate} className="mt-5 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Client</span>
                  <select name="clientId" className={inputCls} required>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Title" name="title" placeholder="Monthly support retainer" />
              </div>
              <label className="block">
                <span className={labelCls}>Description</span>
                <textarea name="description" rows={3} className={textareaCls} required />
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Amount" name="amount" placeholder="500.00" />
                <label className="block">
                  <span className={labelCls}>Frequency</span>
                  <select name="frequency" className={inputCls} defaultValue="monthly">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                <Field label="First draft date" name="nextRunDate" type="date" />
              </div>
              <Field
                label="Payment terms"
                name="paymentTerms"
                defaultValue={DEFAULT_PAYMENT_TERMS}
              />
              <button type="submit" className="inline-flex h-11 w-fit items-center rounded-lg bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]">
                Save repeating template
              </button>
            </form>
          )}
        </section>

        <section className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
          <div className="border-b border-[#f0fdf4] px-5 py-4">
            <h2 className="text-base font-semibold text-[#14532d]">Templates</h2>
          </div>
          {templates.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#4b8068]">No repeating templates yet.</div>
          ) : (
            <div className="divide-y divide-[#f0fdf4]">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function TemplateCard({ template }: { template: TemplateRow }) {
  return (
    <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#14532d]">{template.title}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${template.status === "active" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fef3c7] text-[#92400e]"}`}>
            {template.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-[#4b8068]">
          {template.clients?.name ?? "Client"} · {template.frequency} · next {formatDate(template.next_run_date)}
        </p>
        <p className="mt-1 text-xs text-[#4b8068]">
          {formatPounds(Math.round(Number(template.amount) * 100))} · {template.description}
        </p>
      </div>
      <form action={setRepeatingTemplateStatus}>
        <input type="hidden" name="templateId" value={template.id} />
        <button
          name="status"
          value={template.status === "active" ? "paused" : "active"}
          className="inline-flex h-10 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
        >
          {template.status === "active" ? "Pause" : "Resume"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  defaultValue = "",
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className={inputCls} required />
    </label>
  );
}

function getPageMessage(params: { [key: string]: string | string[] | undefined }) {
  const error = getSingleParam(params.error);
  if (error) return { type: "error" as const, text: error };
  if (params.created) return { type: "success" as const, text: "Repeating template saved." };
  if (params.updated) return { type: "success" as const, text: "Repeating template updated." };
  return null;
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

const labelCls = "text-xs font-semibold uppercase tracking-widest text-[#166534]";
const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]";
const textareaCls =
  "mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm leading-6 text-[#14532d]";
