import BankSourceCoverage from '../../BankSourceCoverage';
import { BankChoiceAmount, BankChoiceWithheld } from '../../BankChoiceReadback';
import { readBankChoiceContext, finishBankChoiceContext } from '@/lib/records/native-choice-store';
import { bankChoiceSource, bankChoiceIndex, nativeDuplicateCohort } from '@/lib/records/native-choice';
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { formatPounds } from "@/lib/invoices/money";
import { minorPence } from "@/lib/records/allocations";
import type { DuplicateChoice } from "@/lib/records/duplicates";
import DuplicateReview from "./DuplicateReview";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function DuplicatesPage({
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
      ? (params[key] as string).toLowerCase()
      : null;
  const selected = id("transaction"),
    after = id("after"),
    historyAfter = id("historyAfter");
  const link = (extra: Record<string, string>) =>
    "/dashboard/reconciliation/duplicates?" +
    new URLSearchParams({
      ...(selected ? { transaction: selected } : {}),
      ...extra,
    });
  let query = db
    .from("duplicate_review_transactions")
    .select("*")
    .eq("user_id", user.id)
    .or("peer_count.gt.0,dedupe_status.neq.clear")
    .order("id")
    .limit(51);
  if (after) query = query.gt("id", after);
  let bankContext: Awaited<ReturnType<typeof readBankChoiceContext>> | null=null;
  try{bankContext=await readBankChoiceContext(db,user.id)}catch{}
  const [choices, selection] = await Promise.all([
    query,
    selected
      ? db
          .from("duplicate_review_transactions")
          .select("*")
          .eq("user_id", user.id)
          .eq("id", selected)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const subject = selection.data as DuplicateChoice | null;
  let cohort: DuplicateChoice[] = [],
    stamp = "",
    unavailable = !bankContext || !!choices.error || !!selection.error;
  type Event = {
    id: string;
    event_kind: string;
    verdict: string;
    rationale: string;
    created_at: string;
    decision_id: string;
    transaction_id: string;
  };
  let history: Event[] = [];
  if (subject) {
    try {
      const before = await db.rpc("duplicate_group_stamp", {
        p_transaction: subject.id,
      });
      if (before.error || !before.data) throw new Error("Unavailable stamp");
      cohort = await readAllExportRows<DuplicateChoice>(async (cursor) => {
        let q = db
          .from("duplicate_review_transactions")
          .select("*")
          .eq("user_id", user.id)
          .eq("account_id", subject.account_id)
          .eq("fingerprint", subject.fingerprint)
          .order("id")
          .limit(500);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      // Use the member read inside this stamped interval, rather than the earlier selection.
      if (!cohort.some((r) => r.id === subject.id))
        throw new Error("Missing observation");
      let h = db
        .from("duplicate_history_events")
        .select(
          "id,event_kind,verdict,rationale,created_at,decision_id,transaction_id",
        )
        .eq("user_id", user.id)
        .or(
          `transaction_id.eq.${subject.id},retained_transaction_id.eq.${subject.id}`,
        )
        .order("id")
        .limit(21);
      if (historyAfter) h = h.gt("id", historyAfter);
      const events = await h;
      if (events.error) throw new Error("Unavailable history");
      history = events.data ?? [];
      const ending = await db.rpc("duplicate_group_stamp", {
        p_transaction: subject.id,
      });
      if (ending.error || ending.data !== before.data)
        throw new Error("Evidence changed");
      stamp = ending.data;
    } catch {
      unavailable = true;
    }
  }
  let coverage=bankContext?.coverage??null,eligibleCohort=false;
  try{
    if(!bankContext||!coverage||unavailable)throw new Error('Bank context unavailable');
    for(const row of choices.data??[])bankChoiceSource(coverage,row);
    if(selected){const source=coverage.observations.find(r=>r.id===selected);if(!source||!subject)throw new Error('Selected identity source unavailable')}
    if(subject)eligibleCohort=nativeDuplicateCohort(coverage,cohort,subject.id);
    coverage=await finishBankChoiceContext(db,user.id,bankContext);
  }catch{unavailable=true;coverage=null}
  const sourceIndex=coverage&&bankChoiceIndex(coverage);
  const current = cohort.find((r) => r.id === selected);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">Overlapping statement review</h1>
        <p>
          Keep every source observation. Resolve whether matching rows describe
          one payment or separate real payments.
        </p>
        <Link
          data-testid="duplicates-reconciliation-link"
          href="/dashboard/reconciliation"
          className="underline"
        >
          Invoice reconciliation
        </Link>
      </header>
      <BankSourceCoverage coverage={coverage}/>
      {current && coverage && !eligibleCohort && <BankChoiceWithheld sources={cohort.map(r=>bankChoiceSource(sourceIndex!,r))} prefix="duplicate"/>}
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 300)}</p>
      )}
      {params.result === "approved" && (
        <p role="status">
          Identity verdict recorded. Business treatment and tax eligibility
          remain separate reviews.
        </p>
      )}
      {params.result === "reversed" && (
        <p role="status">
          Identity verdict reversed. The observation is unresolved; previous
          financial approvals remain excluded.
        </p>
      )}
      {unavailable || !coverage ? (
        <p role="alert">
          Complete overlap evidence is unavailable or changed while loading.
          Reload before reviewing.
        </p>
      ) : (
        <>
          <section className="space-y-3 rounded border p-4">
            <h2 className="text-xl font-semibold">Choose an observation</h2>
            {!choices.data?.length && (
              <p>No overlapping observations on this page.</p>
            )}
            <ul className="space-y-3">
              {(choices.data ?? []).slice(0, 50).map((r: DuplicateChoice) => (
                <li key={r.id}>
                  {r.transaction_date} · {r.account_label} ending{" "}
                  {r.account_mask} · {r.description} ·{" "}
                  {<BankChoiceAmount source={bankChoiceSource(sourceIndex!,r)}/>} ·{" "}
                  {r.dedupe_status} · {r.classification}{" "}
                  <Link
                    data-testid={`duplicate-choice-${r.id}`}
                    href={link({ transaction: r.id })}
                    className="underline"
                  >
                    Review sources and history
                  </Link>
                </li>
              ))}
            </ul>
            <nav
              aria-label="Overlapping observation pages"
              className="flex gap-4"
            >
              {after && <Link href={link({})}>First page</Link>}
              {choices.data && choices.data.length > 50 && (
                <Link href={link({ after: choices.data[49].id })}>
                  More observations
                </Link>
              )}
            </nav>
          </section>
          {current && (
            <>
              <section className="space-y-3 rounded border p-4">
                <h2 className="text-xl font-semibold">
                  Complete matching evidence group ({cohort.length}{" "}
                  observations)
                </h2>
                <p>
                  Same account, normalized date, amount and
                  description/reference fingerprint. Source differences alone do
                  not prove a separate payment.
                </p>
                <ul className="space-y-4">
                  {cohort.map((row) => (
                    <li
                      key={row.id}
                      className="break-words border-b pb-3"
                      data-testid={`duplicate-evidence-${row.id}`}
                    >
                      <p className="font-semibold">
                        {row.id === current.id
                          ? "Selected observation"
                          : "Matching observation"}{" "}
                        · {row.transaction_date} ·{" "}
                        {<BankChoiceAmount source={bankChoiceSource(sourceIndex!,row)}/>}
                      </p>
                      <p>
                        {row.account_label} ending {row.account_mask} ·{" "}
                        {row.description} · Reference: {row.reference || "None"}
                      </p>
                      <p>
                        {row.dedupe_status} · {row.classification} · Import{" "}
                        {row.import_status} · Retained recognised GBP{" "}
                        {row.record_type ?? "effect"}:{" "}
                        {formatPounds(minorPence(row.recognized_pence))}
                      </p>
                      <p>
                        Source SHA-256: {row.file_hash}. Row {row.row_number};
                        SHA-256: {row.row_hash}. Parser: {row.parser_version}.
                        Decision version: {row.decision_version}.
                      </p>
                      <Link
                        data-testid={`duplicate-observation-${row.id}`}
                        href={link({ transaction: row.id })}
                        className="mr-3 underline"
                      >
                        Review this observation and its dependants
                      </Link>
                      <Link
                        data-testid={`duplicate-source-${row.id}`}
                        href={`/dashboard/imports?import=${row.import_id}`}
                        className="underline"
                      >
                        Review source import
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              {eligibleCohort && <DuplicateReview
                subject={current}
                peers={cohort.filter((r) => r.id !== current.id)}
                stamp={stamp}
                requestId={randomUUID()}
              />}
              <section className="space-y-3">
                <h2 className="text-xl font-semibold">
                  Immutable identity history
                </h2>
                <Link
                  className="underline"
                  data-testid="duplicate-export"
                  href={`/api/imports/${current.import_id}/export?format=identities`}
                >
                  Export draft identity history and both source chains
                </Link>
                <ul>
                  {history.slice(0, 20).map((event) => (
                    <li key={event.id}>
                      {event.created_at} · {event.event_kind}: {event.verdict} ·{" "}
                      {event.rationale} · Decision {event.decision_id}{" "}
                      <Link
                        href={link({ transaction: event.transaction_id })}
                        className="underline"
                      >
                        Review decision subject
                      </Link>
                    </li>
                  ))}
                </ul>
                <nav aria-label="Identity history pages" className="flex gap-4">
                  {historyAfter && (
                    <Link href={link({})}>First history page</Link>
                  )}
                  {history.length > 20 && (
                    <Link href={link({ historyAfter: history[19].id })}>
                      More history
                    </Link>
                  )}
                </nav>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
