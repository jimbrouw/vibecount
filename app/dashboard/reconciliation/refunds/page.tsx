import BankSourceCoverage from '../../BankSourceCoverage';
import { BankChoiceAmount, BankChoiceWithheld } from '../../BankChoiceReadback';
import { readBankChoiceContext, finishBankChoiceContext, assertBankChoiceAccountTypes } from '@/lib/records/native-choice-store';
import { bankChoiceSource, nativeBankChoice } from '@/lib/records/native-choice';
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import { minorPence } from "@/lib/records/allocations";
import type { RefundChoice } from "@/lib/records/refunds";
import { readFxSourceDependencies } from "@/lib/fx/dependency-store";
import { requireDependencySources } from "@/lib/fx/dependencies";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import FxDependencyBlockers from "../FxDependencyBlockers";
import RefundReview from "./RefundReview";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function RefundsPage({
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
  const id = (name: string) =>
    typeof params[name] === "string" && uuid.test(params[name])
      ? (params[name] as string).toLowerCase()
      : null;
  const original = id("original"),
    refund = id("refund"),
    after = id("after"),
    groupAfter = id("groupAfter");
  let q = db
    .from("refund_transaction_choices")
    .select("*")
    .eq("user_id", user.id)
    .order("id")
    .limit(51);
  if (after) q = q.gt("id", after);
  let g = db
    .from("refund_transaction_choices")
    .select("*")
    .eq("user_id", user.id)
    .gt("refund_count", 0)
    .order("id")
    .limit(21);
  if (groupAfter) g = g.gt("id", groupAfter);
  let bankContext: Awaited<ReturnType<typeof readBankChoiceContext>> | null=null;
  try{bankContext=await readBankChoiceContext(db,user.id)}catch{}
  const before=bankContext?.financial_stamp??null;
  const [choices, groups, selected] = await Promise.all([
    q,
    g,
    original || refund
      ? db
          .from("refund_transaction_choices")
          .select("*")
          .eq("user_id", user.id)
          .in(
            "id",
            [original, refund].filter((v): v is string => !!v),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rows = (selected.data ?? []) as RefundChoice[],
    o = rows.find((r) => r.id === original),
    r = rows.find((r) => r.id === refund);
  let coverage=bankContext?.coverage??null,unavailable=!bankContext||!!choices.error||!!groups.error||!!selected.error;
  try{
    if(!coverage)throw new Error('Bank context unavailable');
    assertBankChoiceAccountTypes(bankContext!.accounts,[...(choices.data??[]),...(groups.data??[]),...rows]);
    for(const row of [...(choices.data??[]),...(groups.data??[]),...rows])bankChoiceSource(coverage,row);
    for(const id of [original,refund].filter((v):v is string=>!!v)){
      const source=coverage.observations.find(r=>r.id===id);if(!source||source.representation==='native_gbp'&&!rows.some(r=>r.id===id))throw new Error('Selected source unavailable');
    }
  }catch{unavailable=true;coverage=null}
  const selectedSources=coverage?.observations.filter(s=>s.id===original||s.id===refund)??[],blockedSelection=selectedSources.some(s=>s.representation!=='native_gbp');
  let dependencies = null;
  if (o && r && !blockedSelection && !unavailable && before) {
    try {
      dependencies = await readFxSourceDependencies(db, user.id, [o.id, r.id]);
      requireDependencySources(dependencies, [o, r], before);
      if (await readFinancialStamp(() => db.rpc('reconciliation_export_stamp')) !== before) dependencies = null;
    } catch { dependencies = null; }
  }
  try{if(!bankContext||unavailable)throw new Error('Unavailable sources');coverage=await finishBankChoiceContext(db,user.id,bankContext)}catch{unavailable=true;coverage=null;dependencies=null}
  const link = (extra: Record<string, string>) =>
    "/dashboard/reconciliation/refunds?" +
    new URLSearchParams({
      ...(original ? { original } : {}),
      ...(refund ? { refund } : {}),
      ...extra,
    });
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">
          Customer and supplier refunds
        </h1>
        <p>
          Link recorded refund cash to its original payment. The original stays
          intact; a reviewed refund reduces the same income/expense category on
          its own date. This does not move money.
        </p>
        <Link className="underline" href="/dashboard/reconciliation">
          Invoice reconciliation and export
        </Link>
      </header>
      <BankSourceCoverage coverage={coverage}/>
      {blockedSelection && !unavailable && <BankChoiceWithheld sources={selectedSources} prefix="refund"/>}
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 300)}</p>
      )}
      {params.result === "approved" && (
        <p role="status">
          Refund approved. The source-linked accounting reduction is retained.
        </p>
      )}
      {params.result === "reversed" && (
        <p role="status">
          Related refund links reversed. Refund observations are Unknown; the
          original payments are unchanged.
        </p>
      )}
      {unavailable || !coverage ? (
        <p role="alert">
          Refund evidence unavailable. Reload before reviewing.
        </p>
      ) : (
        <>
          <section className="rounded border p-4">
            <h2 className="font-semibold">Choose the original and refund</h2>
            <ul className="space-y-3">
              {choices.data?.slice(0, 50).map((row) => (
                <li key={row.id}>
                  {row.transaction_date} · {row.account_label} ending{" "}
                  {row.account_mask} · {row.description} ·{" "}
                  {<BankChoiceAmount source={bankChoiceSource(coverage,row)}/>} ·{" "}
                  {row.classification}{" "}
                  {!nativeBankChoice(coverage,row) ? <span> — Native refund controls withheld</span> : row.active_transfer_id || row.active_refund_id ? (
                    "— existing relationship"
                  ) : (
                    <>
                      <Link
                        data-testid={`refund-original-${row.id}`}
                        className="ml-3 underline"
                        href={link({ original: row.id })}
                      >
                        Select original
                      </Link>
                      {!row.has_refunds && (
                        <>
                        <Link
                          data-testid={`refund-cash-${row.id}`}
                          className="ml-3 underline"
                          href={link({ refund: row.id })}
                        >
                          Select refund
                        </Link>
                        <Link
                          data-testid={`refund-split-select-${row.id}`}
                          className="ml-3 underline"
                          href={`/dashboard/reconciliation/refunds/split?refund=${row.id}`}
                        >
                          Allocate refund across original payments
                        </Link>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <nav aria-label="Refund source pages" className="flex gap-4">
            {after && <Link href={link({})}>First source page</Link>}
            {choices.data && choices.data.length > 50 && (
              <Link href={link({ after: choices.data[49].id })}>
                More sources
              </Link>
            )}
          </nav>
          {o && r && !blockedSelection && (
            dependencies ? dependencies.blocked ? <FxDependencyBlockers review={dependencies} prefix="refund" operation="Refund approval"/> :
              <RefundReview original={o} refund={r} requestId={randomUUID()} /> : <p role="alert" data-testid="refund-dependencies-unavailable">Complete refund dependencies are unavailable or changed. Reload before reviewing.</p>
          )}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              Active original-payment refund groups
            </h2>
            <p>
              To preserve cumulative penny rounding, reversal removes every
              active refund connected to the selected original together, including
              sibling originals and their other refunds. Refund
              observations return to Unknown without restoring earlier
              classifications; you can review the desired links again.
            </p>
            {groups.data?.slice(0, 20).map((row) => (
              <details key={row.id} className="rounded border p-4">
                <summary>
                  {row.account_label} ending {row.account_mask} ·{" "}
                  {row.transaction_date} · {row.description} ·{" "}
                  {row.refund_count} refunds · retained GBP relationship cash{" "}
                  {formatPounds(minorPence(row.refunded_pence))}
                </summary>
                <Link
                  data-testid={`refund-group-review-${row.id}`}
                  className="block py-3 underline"
                  href={`/dashboard/reconciliation/refunds/reversal?kind=original&id=${row.id}`}
                >
                  Review all connected refunds before reversal
                </Link>
              </details>
            ))}
            <nav aria-label="Refund group pages" className="flex gap-4">
              {groupAfter && <Link href={link({})}>First refund groups</Link>}
              {groups.data && groups.data.length > 20 && (
                <Link href={link({ groupAfter: groups.data[19].id })}>
                  More refund groups
                </Link>
              )}
            </nav>
          </section>
        </>
      )}
    </main>
  );
}
