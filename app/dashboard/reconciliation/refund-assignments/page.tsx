import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  readFinancialStamp,
  readConsistentReconciliation,
} from "@/lib/records/consistent-reconciliation";
import { readAllExportRows } from "@/lib/records/export-pages";
import { minorPence } from "@/lib/records/allocations";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import type { RefundAssignmentChoice } from "@/lib/invoices/refund-assignments";
import type { InvoiceBalanceRow } from "@/lib/invoices/balances";
import { readCurrentAssignmentContext } from "@/lib/records/native-connected-store";
import NativeSourceScope from "../../NativeSourceScope";
import { requireDependencySources } from "@/lib/fx/dependencies";
import FxDependencyBlockers from "../FxDependencyBlockers";
import RefundAssignmentReview from "./RefundAssignmentReview";
import AssignmentReversal from "./AssignmentReversal";
export const metadata = { title: "Match customer refunds — VibeCount" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function RefundAssignmentsPage({
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
  const pair = (key: string) =>
    typeof params[key] === "string" &&
    params[key].split(":").length === 2 &&
    params[key].split(":").every((v) => uuid.test(v))
      ? (params[key] as string)
      : null;
  const refund = id("refund"),
    after = id("after"),
    historyAfter = id("historyAfter"),
    choice = pair("choice"),
    choiceAfter = pair("choiceAfter");
  const link = (extra: Record<string, string>) =>
    "/dashboard/reconciliation/refund-assignments?" +
    new URLSearchParams({
      ...(refund ? { refund } : {}),
      ...(choice ? { choice } : {}),
      ...extra,
    });
  const money = (p: number | string) =>
    `${formatPounds(minorPence(p))} (${amountToWords(minorPence(p))})`;
  const readStamp = () =>
    readFinancialStamp(() => db.rpc("reconciliation_export_stamp"));
  const result = await readConsistentReconciliation(readStamp, async () => {
    const stamp = await readStamp();
    let r = db
      .from("customer_refund_balances")
      .select(
        "id,transaction_date,description,amount_pence,assigned_pence,unassigned_pence,account_label,account_mask,import_id,original_import_id,original_date,original_description",
      )
      .eq("user_id", user.id)
      .order("id")
      .limit(51);
    if (after) r = r.gt("id", after);
    let c = db
      .from("invoice_refund_choices")
      .select("*")
      .eq("user_id", user.id)
      .eq("refund_id", refund ?? "00000000-0000-4000-8000-000000000000")
      .order("id")
      .limit(51);
    if (choiceAfter) c = c.gt("id", choiceAfter);
    let h = db
      .from("invoice_refund_assignments")
      .select(
        "id,invoice_id,allocation_id,credit_id,refund_id,amount_pence,rationale,created_at,invoice_snapshot,credit_snapshot",
      )
      .eq("user_id", user.id)
      .order("id")
      .limit(21);
    if (historyAfter) h = h.gt("id", historyAfter);
    const [refunds, choices, selected, history, selectedRefund] =
      await Promise.all([
        r,
        c,
        choice && refund
          ? db
              .from("invoice_refund_choices")
              .select("*")
              .eq("user_id", user.id)
              .eq("refund_id", refund)
              .eq("id", choice)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        h,
        refund
          ? db
              .from("customer_refund_balances")
              .select("*")
              .eq("user_id", user.id)
              .eq("id", refund)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    if (
      refunds.error ||
      choices.error ||
      selected.error ||
      history.error ||
      selectedRefund.error ||
      (selected.data && !selectedRefund.data)
    )
      throw new Error("Assignment data unavailable.");
    const current = selected.data ? await readCurrentAssignmentContext(db,user.id,selected.data.allocation_id,selected.data.refund_id) : null;
    const dependencies=current?.dependencies??null;
    if(dependencies&&selected.data)requireDependencySources(dependencies,[{id:selected.data.original_transaction_id},{id:selected.data.refund_transaction_id}],stamp);
    const invoiceIds = [
      ...new Set((history.data ?? []).slice(0, 20).map((a) => a.invoice_id)),
    ];
    const [balances, reversals] = invoiceIds.length
      ? await Promise.all([
          readAllExportRows<
            Pick<
              InvoiceBalanceRow,
              "id" | "invoice_pence" | "allocated_pence" | "credited_pence"
            > & { returned_pence: number | string }
          >(async (cursor) => {
            let q = db
              .from("invoice_payment_balances")
              .select(
                "id,invoice_pence,allocated_pence,credited_pence,returned_pence",
              )
              .eq("user_id", user.id)
              .in("id", invoiceIds)
              .order("id")
              .limit(500);
            if (cursor) q = q.gt("id", cursor);
            const r = await q;
            return { data: r.data, error: r.error };
          }),
          readAllExportRows<{
            id: string;
            assignment_id: string;
            rationale: string;
            created_at: string;
          }>(async (cursor) => {
            let q = db
              .from("invoice_refund_assignment_reversals")
              .select("id,assignment_id,rationale,created_at")
              .eq("user_id", user.id)
              .in(
                "assignment_id",
                history.data!.slice(0, 20).map((a) => a.id),
              )
              .order("id")
              .limit(500);
            if (cursor) q = q.gt("id", cursor);
            return await q;
          }),
        ])
      : [[], []];
    return {
      stamp,
      selectedRefund: selectedRefund.data,
      refunds: refunds.data ?? [],
      choices: choices.data ?? [],
      dependencies,
      current,
      selected: selected.data as RefundAssignmentChoice | null,
      history: history.data ?? [],
      balances,
      reversals,
    };
  }).catch(() => null);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">
          Match recorded customer refunds
        </h1>
        <p>
          Link cash already returned to a reviewed credit and its original
          receipt allocation. Matching changes retained invoice cash and records
          no extra income or expense.
        </p>
        <Link
          href="/dashboard/reconciliation"
          className="underline"
          data-testid="assignments-reconciliation-link"
        >
          Invoice reconciliation and export
        </Link>
      </header>
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 300)}</p>
      )}
      {params.result && (
        <p role="status">
          {params.result === "assigned"
            ? "Refund assignment approved."
            : "Refund assignment reversed. Its parent receipt, credit and refund remain intact."}
        </p>
      )}
      {!result ? (
        <p role="alert" data-testid="assignments-unavailable">
          Complete assignment evidence is unavailable or changed while loading.
          Reload to review current balances.
        </p>
      ) : (
        <>
          <section aria-label="Recorded customer refunds" className="space-y-3">
            <h2 className="text-xl font-semibold">
              Choose a reviewed customer refund
            </h2>
            {!result.refunds.length && (
              <p>
                No customer refunds on this page. Review the bank refund and
                original receipt first.
              </p>
            )}
            {result.refunds.slice(0, 50).map((r) => (
              <article key={r.id} className="space-y-2 rounded border p-3">
                <Link
                  className="underline"
                  data-testid={`assignment-refund-${r.id}`}
                  href={link({ refund: r.id, choice: "" })}
                >
                  {r.transaction_date} · {r.description}
                </Link>
                <p>
                  {r.account_label} ending {r.account_mask} · refund{" "}
                  {money(r.amount_pence)}; matched {money(r.assigned_pence)};
                  unassigned {money(r.unassigned_pence)}.
                </p>
                <p>
                  Original receipt: {r.original_date} · {r.original_description}
                  .{" "}
                  <Link
                    href={`/dashboard/imports?import=${r.original_import_id}`}
                    className="underline"
                  >
                    Original source
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href={`/dashboard/imports?import=${r.import_id}`}
                    className="underline"
                  >
                    Refund source
                  </Link>
                </p>
              </article>
            ))}
            {result.refunds.length > 50 && (
              <Link
                href={link({ after: result.refunds[49].id })}
                className="underline"
                data-testid="assignment-next-refunds"
              >
                Next refunds
              </Link>
            )}
          </section>
          {refund && (
            <section
              className="space-y-3"
              aria-label="Credit and receipt choices"
            >
              <h2 className="text-xl font-semibold">
                Choose the credit and original receipt allocation
              </h2>
              {!result.choices.length && (
                <p>
                  No matching active credit and receipt allocation on this page.
                  Both must belong to the same invoice and original receipt.
                </p>
              )}
              <ul className="space-y-2">
                {result.choices.slice(0, 50).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={link({ choice: c.id })}
                      className="underline"
                      data-testid={`assignment-choice-${c.id}`}
                    >
                      {c.invoice_number} · {c.credit_number}
                    </Link>{" "}
                    · credit remaining {money(c.credit_remaining_pence)};
                    receipt allocation remaining{" "}
                    {money(c.allocation_remaining_pence)}; refund remaining{" "}
                    {money(c.refund_remaining_pence)}
                  </li>
                ))}
              </ul>
              {result.choices.length > 50 && (
                <Link
                  href={link({ choiceAfter: result.choices[49].id })}
                  className="underline"
                >
                  Next choices
                </Link>
              )}
            </section>
          )}
          {result.selected && result.selectedRefund && (
            <section
              className="space-y-3"
              aria-label="Selected refund evidence"
            >
              <p>
                {result.selectedRefund.transaction_date} ·{" "}
                {result.selectedRefund.description} ·{" "}
                {result.selectedRefund.account_label} ending{" "}
                {result.selectedRefund.account_mask}. Original receipt{" "}
                {result.selectedRefund.original_date}:{" "}
                {result.selectedRefund.original_description}.
              </p>
              <p>
                Retained GBP refund history {money(result.selectedRefund.amount_pence)};
                already assigned {money(result.selectedRefund.assigned_pence)};
                unassigned {money(result.selectedRefund.unassigned_pence)}.
              </p>
              <Link
                href={`/dashboard/imports?import=${result.selectedRefund.original_import_id}`}
                className="mr-3 underline"
              >
                Original receipt source
              </Link>
              <Link
                href={`/dashboard/imports?import=${result.selectedRefund.import_id}`}
                className="mr-3 underline"
              >
                Refund source
              </Link>
              <a
                href={`/api/reconciliation/credits/${result.selected.credit_id}`}
                className="underline"
              >
                Preserved credit PDF
              </a>
              {result.current&&<NativeSourceScope context={result.current.source_context} prefix="refund-assignment"/>}
              {result.dependencies?.blocked&&<FxDependencyBlockers review={result.dependencies} prefix="refund-assignment" operation="Returned-cash assignment"/>}
              {result.current ? !result.current.blocked&&<RefundAssignmentReview choice={result.selected} stamp={result.stamp} sourceStamp={result.current.source_context.source_stamp} requestId={randomUUID()}/> : <p role="alert">Complete receipt dependencies unavailable. Reload before reviewing.</p>}
            </section>
          )}
          <section aria-label="Refund assignment history" className="space-y-4">
            <h2 className="text-xl font-semibold">Assignment history</h2>
            {!result.history.length && <p>No assignments on this page.</p>}
            {result.history.slice(0, 20).map((a) => {
              const reversal = result.reversals.find(
                  (r) => r.assignment_id === a.id,
                ),
                invoice = result.balances.find((b) => b.id === a.invoice_id);
              return (
                <article
                  key={a.id}
                  className="space-y-3 rounded border p-4"
                  data-testid={`assignment-history-${a.id}`}
                >
                  <h3 className="font-semibold">
                    {a.invoice_snapshot.number} · {a.credit_snapshot.number} ·{" "}
                    {reversal ? "Reversed" : "Approved"}
                  </h3>
                  <p>
                    {money(a.amount_pence)} · {a.rationale}
                  </p>
                  <Link
                    className="underline"
                    href={`/dashboard/reconciliation/credits?invoice=${a.invoice_id}`}
                  >
                    Credit and original invoice evidence
                  </Link>
                  <p className="break-all text-xs">
                    Credit PDF SHA-256: {a.credit_snapshot.pdf_sha256}. Original
                    receipt allocation {a.allocation_id}; reviewed refund{" "}
                    {a.refund_id}.
                  </p>
                  {reversal ? (
                    <p>
                      Reversed {reversal.created_at}: {reversal.rationale}
                    </p>
                  ) : invoice ? (
                    <AssignmentReversal
                      id={a.id}
                      amount={a.amount_pence}
                      stamp={result.stamp}
                      requestId={randomUUID()}
                      invoice={invoice}
                    />
                  ) : (
                    <p role="alert">
                      Current invoice balance unavailable; reload before
                      reversing.
                    </p>
                  )}
                </article>
              );
            })}
            {result.history.length > 20 && (
              <Link
                className="underline"
                data-testid="assignment-next-history"
                href={link({ historyAfter: result.history[19].id })}
              >
                Next assignment history
              </Link>
            )}
          </section>
        </>
      )}
    </main>
  );
}
