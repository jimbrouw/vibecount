import { isNativeGbpInvoice } from "@/lib/invoices/native";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import { requirePence } from "@/lib/money";

export default async function InvoiceHistory({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; before?: string }>;
}) {
  const db = await createClient();
  const {
    data: { user }, error: authError,
  } = await db.auth.getUser();
  if (authError || !user) redirect("/login");
  const { id, before } = await searchParams;
  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .select("id,number,economics_version,origin,currency,amount")
    .eq("id", id ?? "")
    .eq("user_id", user.id)
    .maybeSingle();
  if (invoiceError || !invoice)
    return (
      <main>
        <h1>Invoice history unavailable</h1>
        <Link href="/dashboard">Return to invoices</Link>
      </main>
    );
  if (!isNativeGbpInvoice(invoice)) return <main className="space-y-4 p-6" data-testid="invoice-native-history-unavailable"><h1>Preserved invoice history needs its evidence workflow</h1><p>Native GBP PDF and VAT history does not describe this invoice.</p><Link data-testid="invoice-native-history-evidence" href="/dashboard/reconciliation/fx/evidence">Review document evidence</Link></main>;
  let query = db
    .from("invoice_revisions")
    .select("id,version,snapshot,pdf_path,pdf_sha256,created_at,origin")
    .eq("origin", "native_gbp")
    .eq("invoice_id", invoice.id)
    .eq("user_id", user.id)
    .order("version", { ascending: false })
    .limit(50);
  if (before && /^\d+$/.test(before))
    query = query.lt("version", Number(before));
  const { data, error } = await query;
  return (
    <main
      className="mx-auto max-w-3xl space-y-5 p-6"
      data-testid="invoice-history"
    >
      <Link href="/dashboard" data-testid="invoice-history-back">
        Invoices
      </Link>
      <h1 className="text-2xl font-semibold">History for {invoice.number}</h1>
      <p>
        Each confirmed revision preserves its amount breakdown and PDF. Earlier
        revisions remain available. Legacy entries retain the original total; an
        unknown VAT breakdown is not inferred.
      </p>
      {error ? (
        <p role="alert">Revision history could not be read. Try again.</p>
      ) : (
        data?.map((revision) => {
          const s = revision.snapshot as {
            amount?: string | number;
            net_pence?: number;
            vat_pence?: number;
            vat_rate_bps?: number;
            reason?: string;
            description?: string;
          };
          const total = s.amount === undefined ? null : requirePence(s.amount);
          return (
            <article
              key={revision.id}
              data-testid={`invoice-revision-${revision.version}`}
              className="space-y-2 rounded-xl border p-4"
            >
              <h2 className="font-semibold">
                {revision.version === 0
                  ? "Legacy evidence"
                  : `Revision ${revision.version}`}
                {revision.version === invoice.economics_version
                  ? " — current"
                  : ""}
              </h2>
              <p>{revision.created_at}</p>
              <p>{s.description}</p>
              {total !== null && (
                <p>
                  Total {formatPounds(total)} ({amountToWords(total)})
                </p>
              )}
              {s.net_pence != null && s.vat_pence != null ? (
                <p>
                  Net {formatPounds(Number(s.net_pence))} (
                  {amountToWords(Number(s.net_pence))}); VAT{" "}
                  {formatPounds(Number(s.vat_pence))} (
                  {amountToWords(Number(s.vat_pence))}) at{" "}
                  {Number(s.vat_rate_bps ?? 0) / 100}%.
                </p>
              ) : (
                <p>Net amount and VAT: unverified.</p>
              )}
              {s.reason && <p>Reason: {s.reason}</p>}
              {revision.pdf_path ? (
                <Link
                  data-testid={`invoice-revision-download-${revision.version}`}
                  href={`/api/invoices/download?id=${invoice.id}&revision=${revision.id}`}
                >
                  Download this preserved PDF
                </Link>
              ) : (
                <p>
                  Original PDF unavailable. Review evidence before
                  reconstruction.
                </p>
              )}
              {revision.pdf_sha256 ? (
                <p className="break-all text-xs">
                  PDF SHA-256: {revision.pdf_sha256}
                </p>
              ) : (
                <p>Original PDF hash was not recorded.</p>
              )}
            </article>
          );
        })
      )}
      {!error && data?.length === 0 && <p>No preserved revisions yet.</p>}
      {!error && data?.length === 50 && (
        <Link
          data-testid="invoice-history-more"
          href={`/dashboard/invoices/history?id=${invoice.id}&before=${data[data.length - 1].version}`}
        >
          Older revisions
        </Link>
      )}
    </main>
  );
}
