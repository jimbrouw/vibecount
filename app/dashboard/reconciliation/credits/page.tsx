import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import type { CreditBalance } from "@/lib/invoices/credits";
import { minorPence } from "@/lib/records/allocations";
import { readAllExportRows } from "@/lib/records/export-pages";
import CreditReview from "./CreditReview";
import CreditReversal from "./CreditReversal";
export const metadata = { title: "Invoice credits — VibeCount" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const params = await searchParams;
  const id = (key: string) =>
    typeof params[key] === "string" && uuid.test(params[key])
      ? (params[key] as string)
      : null;
  const selected = id("invoice"),
    after = id("after"),
    historyAfter = id("historyAfter");
  let listQuery = db
    .from("invoice_credit_choices")
    .select(
      "id,number,invoice_pence,credited_pence,outstanding_pence,refund_due_pence",
    )
    .eq("user_id", user.id)
    .eq("status", "finalised")
    .eq("currency", "GBP")
    .order("id")
    .limit(51);
  if (after) listQuery = listQuery.gt("id", after);
  const [list, chosen] = await Promise.all([
    listQuery,
    selected
      ? db
          .from("invoice_credit_choices")
          .select("*")
          .eq("user_id", user.id)
          .eq("id", selected)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const invoice = chosen.data as (CreditBalance & { client_id: string }) | null;
  let historyQuery = db
    .from("invoice_credit_notes")
    .select(
      "id,number,ordinal,credit_date,gross_pence,tax_status,pdf_sha256,invoice_snapshot,rationale",
    )
    .eq("user_id", user.id)
    .eq("invoice_id", selected ?? "00000000-0000-4000-8000-000000000000")
    .order("id")
    .limit(21);
  if (historyAfter) historyQuery = historyQuery.gt("id", historyAfter);
  const [history, latest, settings, client] = await Promise.all([
    historyQuery,
    db
      .from("active_invoice_credits")
      .select("id")
      .eq("user_id", user.id)
      .eq("invoice_id", selected ?? "00000000-0000-4000-8000-000000000000")
      .order("ordinal", { ascending: false })
      .limit(1),
    invoice
      ? db
          .from("user_settings")
          .select("legal_name,address")
          .eq("id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    invoice
      ? db
          .from("clients")
          .select("name,address")
          .eq("user_id", user.id)
          .eq("id", invoice.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const reversed = history.data?.length
    ? await db
        .from("invoice_credit_reversals")
        .select("credit_id,rationale,created_at")
        .eq("user_id", user.id)
        .in(
          "credit_id",
          history.data.slice(0, 20).map((c) => c.id),
        )
    : { data: [], error: null };
  const dependencies = history.data?.length
    ? await readAllExportRows<{ id: string; credit_id: string }>(
        async (cursor) => {
          let q = db
            .from("active_invoice_refund_assignments")
            .select("id,credit_id")
            .eq("user_id", user.id)
            .in(
              "credit_id",
              history.data!.slice(0, 20).map((c) => c.id),
            )
            .order("id")
            .limit(500);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        },
      ).catch(() => null)
    : [];
  const unavailable =
    dependencies === null ||
    list.error ||
    chosen.error ||
    history.error ||
    latest.error ||
    reversed.error ||
    settings.error ||
    client.error;
  const link = (extra: Record<string, string>) =>
    "/dashboard/reconciliation/credits?" +
    new URLSearchParams({
      ...(selected ? { invoice: selected } : {}),
      ...extra,
    });
  const money = (p: number | string) =>
    `${formatPounds(minorPence(p))} (${amountToWords(minorPence(p))})`;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date());
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">Invoice credits</h1>
        <p>
          A reviewed credit reduces what the customer owes. It preserves the
          original invoice and records no cash movement. Cash refunds are
          reviewed separately.
        </p>
        <Link
          href="/dashboard/reconciliation"
          className="underline"
          data-testid="credits-reconciliation-link"
        >
          Invoice reconciliation and export
        </Link>
      </header>
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 300)}</p>
      )}
      {params.result === "reversed" && (
        <p role="status">Credit reversed. Its evidence remains in history.</p>
      )}
      {unavailable ? (
        <p role="alert">
          Credit evidence or balances are unavailable. Reload before reviewing;
          no zero balances are assumed.
        </p>
      ) : (
        <>
          <section aria-label="Choose invoice" className="space-y-3">
            <h2 className="text-xl font-semibold">
              Choose a finalised GBP invoice
            </h2>
            {!list.data?.length && <p>No invoices on this page.</p>}
            <ul className="space-y-2">
              {list.data?.slice(0, 50).map((row) => (
                <li key={row.id}>
                  <Link
                    className="underline"
                    data-testid={`credit-invoice-${row.id}`}
                    href={link({ invoice: row.id })}
                  >
                    {row.number}
                  </Link>{" "}
                  · original {money(row.invoice_pence)}; credited{" "}
                  {money(row.credited_pence)}; outstanding{" "}
                  {money(row.outstanding_pence)}; cash to reconcile{" "}
                  {money(row.refund_due_pence)}
                </li>
              ))}
            </ul>
            {list.data && list.data.length > 50 && (
              <Link
                className="underline"
                data-testid="credit-next-invoices"
                href={link({ after: list.data[49].id })}
              >
                Next invoices
              </Link>
            )}
          </section>
          {selected && !invoice && (
            <p role="alert">Selected invoice is unavailable.</p>
          )}
          {invoice && (
            <>
              <CreditReview
                invoice={invoice}
                parties={{
                  sellerName: settings.data?.legal_name ?? "",
                  sellerAddress: settings.data?.address ?? "",
                  clientName: client.data?.name ?? "",
                  clientAddress: client.data?.address ?? "",
                }}
                today={today}
                requestId={randomUUID()}
              />
              <section aria-label="Credit history" className="space-y-4">
                <h2 className="text-xl font-semibold">
                  Credit history for {invoice.number}
                </h2>
                <Link
                  href={`/dashboard/invoices/history?id=${invoice.id}`}
                  className="underline"
                  data-testid="credit-original-history"
                >
                  Original invoice revisions
                </Link>
                {!history.data?.length && <p>No credit notes on this page.</p>}
                {history.data?.slice(0, 20).map((credit) => {
                  const reversal = reversed.data?.find(
                    (r) => r.credit_id === credit.id,
                  );
                  return (
                    <article
                      key={credit.id}
                      className="space-y-3 rounded border p-4"
                      data-testid={`credit-history-${credit.id}`}
                    >
                      <h3 className="font-semibold">
                        {credit.number} ·{" "}
                        {reversal
                          ? "Reversed"
                          : "Approved commercial credit; draft PDF not sent"}
                      </h3>
                      <p>
                        {credit.credit_date} · {money(credit.gross_pence)} ·{" "}
                        {credit.tax_status === "unverified"
                          ? "Original VAT unresolved"
                          : "Original invoice VAT snapshot"}
                      </p>
                      <p>Reason: {credit.rationale}</p>
                      <p className="break-all text-sm">
                        Preserved PDF SHA-256: {credit.pdf_sha256}
                      </p>
                      <a
                        href={`/api/reconciliation/credits/${credit.id}`}
                        className="underline"
                        data-testid={`credit-download-${credit.id}`}
                      >
                        Download preserved draft credit PDF
                      </a>
                      {reversal ? (
                        <p>
                          Reversed {reversal.created_at}: {reversal.rationale}
                        </p>
                      ) : dependencies?.some(
                          (a) => a.credit_id === credit.id,
                        ) ? (
                        <Link
                          href="/dashboard/reconciliation/refund-assignments"
                          className="underline"
                        >
                          Review and reverse linked refund assignments before
                          this credit.
                        </Link>
                      ) : latest.data?.[0]?.id === credit.id ? (
                        <CreditReversal
                          creditId={credit.id}
                          gross={credit.gross_pence}
                          invoice={invoice}
                          requestId={randomUUID()}
                        />
                      ) : (
                        <p>
                          Reverse later active credits first to preserve penny
                          rounding.
                        </p>
                      )}
                    </article>
                  );
                })}
                {history.data && history.data.length > 20 && (
                  <Link
                    href={link({ historyAfter: history.data[19].id })}
                    className="underline"
                    data-testid="credit-next-history"
                  >
                    Next credit history
                  </Link>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
