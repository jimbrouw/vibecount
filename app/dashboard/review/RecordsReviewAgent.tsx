"use client";

import { useState } from "react";

import type { FinancialReview } from "@/lib/records/financial-review";
import { financialReviewBankSummary } from "@/lib/records/financial-review";
import { fxAggregateReadback } from "@/lib/fx/readback";

export default function RecordsReviewAgent({
  summary,
}: {
  summary: FinancialReview;
}) {
  const [consent,setConsent]=useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [suggestion, setSuggestion] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const bankSummary=financialReviewBankSummary(summary);

  async function runReview() {
    if(!consent)return;
    setState("loading");
    setSuggestion("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/review/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({schema_version:"financial-review-request/1",tax_year_start:summary.tax_year_start,expected_stamp:summary.stamp,consent:true}),
      });

      const data = (await res.json()) as {
        suggestion?: string;
        error?: string;
      };

      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? "Review failed. Try again.");
        setState("error");
        return;
      }

      setSuggestion(data.suggestion ?? "");
      setState("done");
    } catch {
      setErrorMsg("Could not reach the review service. Check your connection.");
      setState("error");
    } finally { setConsent(false); }
  }

  return (
    <div data-testid="review-agent-section">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#14532d]">
            AI records review
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#4b8068]">
            Ask the assistant to summarise review gaps and balances. It reads only and cannot approve records or certify tax completeness.
          </p>
        </div>
        <button
          type="button"
          onClick={runReview}
          disabled={!consent || state === "loading"}
          data-testid="run-review-button"
          className="inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d] disabled:opacity-50"
        >
          {state === "loading" ? "Reviewing…" : "Run review"}
        </button>
      </div>

      <details className="mb-4" data-testid="review-shared-summary">
        <summary data-testid="review-shared-summary-toggle">Review the summary that may be shared</summary>
        <p>{summary.approved_count} approved records in total. Sample: {summary.recent_records.length} most recent approved records. Overdue sample: {summary.overdue_invoices.length} of {summary.native_overdue_count} native GBP invoices.</p>
        <p data-testid="review-shared-bank-summary">{bankSummary.owned_accounts} owned accounts; {bankSummary.preserved_observations} preserved bank observations across all years. This tax year: {bankSummary.active_year_observations} active observations, {bankSummary.unsupported_year_observations} unsupported sources, {bankSummary.unavailable_year_source_metadata} with unavailable source metadata. Counts overlap. Metadata existence does not prove readable retained bytes.</p>
        <p>{bankSummary.foreign_accounts} foreign accounts; {bankSummary.invalid_accounts} invalid account representations; {bankSummary.reviewed_zero_valuations} retained reviewed zero valuations. These describe all owned sources, not this tax year&apos;s activity or available cash.</p>
        <ul data-testid="review-shared-bank-quarters">{summary.quarters.map(q=><li key={q.quarter}>{q.label}: {q.source_count} active sources, {q.unresolved_source_count} unresolved, {q.unsupported_source_count} unsupported, {q.source_unavailable_count} with unavailable source metadata. Counts overlap.</li>)}</ul>
        <ul data-testid="review-shared-bank-currencies">{bankSummary.original_currency_observation_groups.map(g=><li key={g.currency}>{g.currency}: {g.observation_count} preserved observations; original currency is separate from GBP ledger totals.</li>)}</ul>
        <ul>{summary.recent_records.map(r=><li key={r.id}>{r.label} · {r.record_date} · {r.record_type} · {fxAggregateReadback(r.amount_pence,"GBP")} · {r.categorised?"category recorded":"category missing"}</li>)}</ul>
        <ul>{summary.overdue_invoices.map(i=><li key={i.id}>{i.label} · due {i.due_date} · outstanding {fxAggregateReadback(i.outstanding_pence,"GBP")}{i.manual_paid_marker?" · manual paid marker requires cash reconciliation":""}</li>)}</ul>
      </details>
      <label className="mb-4 block"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={state==="loading"} data-testid="review-provider-consent" /> I agree to share these counts, dates, amounts, currency groups and generated sample labels with Anthropic for this request. No original files, descriptions, client names or invoice references are included.</label>
      {state === "idle" && (
        <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-[#f7fef9] px-5 py-8 text-center">
          <p className="text-sm text-[#4b8068]">
            Press <strong>Run review</strong> to get a read-only analysis of
            your records.
          </p>
          <p className="mt-1 text-xs text-[#86a88e]">
            No financial data is changed. The server reloads current review data before sharing the bounded summary.
          </p>
        </div>
      )}

      {state === "loading" && (
        <div className="rounded-xl border border-[#bbf7d0] bg-white px-5 py-8 text-center">
          <p className="text-sm text-[#4b8068]">Analysing your records…</p>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-xl border border-[#e0b4a7] bg-[#fff7f3] px-5 py-4">
          <p className="text-sm text-[#7a271a]">{errorMsg}</p>
          <button
            type="button"
            onClick={runReview}
            disabled={!consent}
            className="mt-3 text-xs font-semibold text-[#15803d] underline"
          >
            Try again
          </button>
        </div>
      )}

      {state === "done" && suggestion && (
        <div
          className="rounded-xl border border-[#bbf7d0] bg-white p-5"
          data-testid="review-result"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Review findings
          </p>
          <div className="prose prose-sm prose-green max-w-none text-[#14532d]">
            {suggestion.split("\n").map((line, i) => {
              const trimmed = line.trim();
              if (!trimmed) return null;
              const isBullet =
                trimmed.startsWith("-") ||
                trimmed.startsWith("•") ||
                /^\d+\./.test(trimmed);
              return (
                <p
                  key={i}
                  className={`${isBullet ? "pl-4" : ""} text-sm leading-6 text-[#14532d]`}
                >
                  {trimmed}
                </p>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[#86a88e]">
            This is an AI estimate only. Verify findings before acting. No
            records were changed.
          </p>
          <button
            type="button"
            onClick={runReview}
            disabled={!consent}
            className="mt-3 text-xs font-semibold text-[#15803d] underline"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
