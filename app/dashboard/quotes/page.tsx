import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import LogoutButton from "../LogoutButton";
import { createQuote, createService, setQuoteStatus } from "./actions";
import QuoteDateFields from "./QuoteDateFields";
import QuoteEmailButton from "./QuoteEmailButton";

export const metadata = {
  title: "Quotes — VibeCount",
  description: "Create quotes from reusable services.",
};

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  unit_price: string | number;
};

type QuoteRow = {
  id: string;
  number: string;
  quote_date: string;
  valid_until: string | null;
  status: "draft" | "sent" | "accepted" | "declined";
  notes: string | null;
  clients: { name: string } | null;
  quote_line_items: {
    description: string;
    quantity: string | number;
    unit_price: string | number;
  }[];
};

export default async function QuotesPage({
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
  const [servicesResult, quotesResult, settingsResult] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, description, unit_price")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("quotes")
      .select(
        "id, number, quote_date, valid_until, status, notes, clients(name), quote_line_items(description, quantity, unit_price)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("user_settings")
      .select("legal_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const services = (servicesResult.data ?? []) as ServiceRow[];
  const quotes = (quotesResult.data ?? []) as unknown as QuoteRow[];
  const senderName = settingsResult.data?.legal_name ?? user.email ?? "";

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
            <Link href="/dashboard/quotes" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">
              Quotes
            </Link>
            <Link href="/dashboard/records" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              Records
            </Link>
            <Link href="/dashboard/tax-prep" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              Tax prep
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-white/80 sm:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
            Quotes and services
          </h1>
          <p className="mt-1 text-sm text-[#166534]">
            Save repeatable services, create quote PDFs, then turn accepted quotes into invoice drafts.
          </p>
        </div>

        {message && (
          <div className={`mb-6 rounded-xl border p-4 text-sm ${message.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-[#bbf7d0] bg-white text-[#14532d]"}`}>
            {message.text}
          </div>
        )}

        <section className="mb-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <ServiceForm />
          <QuoteForm services={services} />
        </section>

        <section className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
          <div className="border-b border-[#f0fdf4] px-5 py-4">
            <h2 className="text-base font-semibold text-[#14532d]">Recent quotes</h2>
          </div>
          {quotes.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#4b8068]">No quotes yet.</div>
          ) : (
            <div className="divide-y divide-[#f0fdf4]">
              {quotes.map((quote) => (
                <QuoteCard key={quote.id} quote={quote} senderName={senderName} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ServiceForm() {
  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-[#14532d]">Save a service</h2>
      <form action={createService} className="mt-5 space-y-4">
        <Field label="Service name" name="name" placeholder="Workshop day" />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Description</span>
          <textarea name="description" rows={3} className={textareaCls} placeholder="Planning, delivery, and follow-up notes." required />
        </label>
        <Field label="Price" name="unitPrice" placeholder="850.00" />
        <button type="submit" className={primaryButtonCls}>Save service</button>
      </form>
    </section>
  );
}

function QuoteForm({ services }: { services: ServiceRow[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-[#14532d]">Create a quote</h2>
      <form action={createQuote} className="mt-5 space-y-4">
        <div className="grid gap-4">
          <Field label="Client" name="clientName" placeholder="Client name" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <QuoteDateFields initialDate={today} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Saved service</span>
            <select name="serviceId" className={selectCls} defaultValue="">
              <option value="">Custom line item</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {formatPounds(Math.round(Number(service.unit_price) * 100))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Description</span>
          <textarea name="description" rows={3} className={textareaCls} placeholder="Describe the quoted work." required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantity" name="quantity" defaultValue="1" />
          <Field label="Unit price" name="unitPrice" placeholder="850.00" />
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Notes</span>
          <textarea name="notes" rows={2} className={textareaCls} placeholder="Scope, assumptions, or next steps." />
        </label>
        <button type="submit" className={primaryButtonCls}>Create quote</button>
      </form>
    </section>
  );
}

function QuoteCard({ quote, senderName }: { quote: QuoteRow; senderName: string }) {
  const firstItem = quote.quote_line_items[0];
  const totalPence = quote.quote_line_items.reduce(
    (total, item) => total + Math.round(Number(item.quantity) * Number(item.unit_price) * 100),
    0
  );
  const invoiceHref = `/dashboard/invoices/new?source=quote&clientName=${encodeURIComponent(
    quote.clients?.name ?? ""
  )}&description=${encodeURIComponent(firstItem?.description ?? "")}&amount=${encodeURIComponent(
    String(totalPence / 100)
  )}`;

  return (
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#14532d]">{quote.number}</p>
          <StatusBadge status={quote.status} />
        </div>
        <p className="mt-1 text-sm text-[#4b8068]">
          {quote.clients?.name ?? "Client"} · {firstItem?.description ?? "No line item"}
        </p>
        <p className="mt-1 text-xs text-[#4b8068]">
          {formatPounds(totalPence)} · {formatQuoteDate(quote.quote_date)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/quotes/${quote.id}/pdf`} className={secondaryButtonCls}>PDF</a>
        <QuoteEmailButton
          quoteId={quote.id}
          clientName={quote.clients?.name ?? ""}
          quoteNumber={quote.number}
          amount={formatPounds(totalPence)}
          validUntil={quote.valid_until ? formatQuoteDate(quote.valid_until) : ""}
          senderName={senderName}
        />
        <Link href={invoiceHref} className={secondaryButtonCls}>Convert to invoice</Link>
        {(["sent", "accepted", "declined"] as const).map((status) => (
          <form action={setQuoteStatus} key={status}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <button name="status" value={status} className={secondaryButtonCls}>
              Mark {status}
            </button>
          </form>
        ))}
      </div>
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
      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">{label}</span>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className={inputCls} required={name !== "validUntil"} />
    </label>
  );
}

function StatusBadge({ status }: { status: QuoteRow["status"] }) {
  const className =
    status === "accepted"
      ? "bg-[#dcfce7] text-[#15803d]"
      : status === "declined"
        ? "bg-[#fef3c7] text-[#92400e]"
        : "bg-[#e0f2fe] text-[#075985]";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{status}</span>;
}

function getPageMessage(params: { [key: string]: string | string[] | undefined }) {
  const error = getSingleParam(params.error);
  if (error) return { type: "error" as const, text: error };
  if (params.serviceCreated) return { type: "success" as const, text: "Service saved." };
  if (params.quoteCreated) return { type: "success" as const, text: "Quote created." };
  if (params.quoteUpdated) return { type: "success" as const, text: "Quote updated." };
  return null;
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatQuoteDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]";
const selectCls = inputCls;
const textareaCls =
  "mt-1 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm leading-6 text-[#14532d]";
const primaryButtonCls =
  "inline-flex h-11 items-center rounded-lg bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]";
const secondaryButtonCls =
  "inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";
