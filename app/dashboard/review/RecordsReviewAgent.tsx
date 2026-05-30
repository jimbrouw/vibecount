"use client";

import { useState } from "react";

type ReviewSummary = {
  currentTaxYear: string;
  approvedCount: number;
  reviewCount: number;
  quarters: {
    label: string;
    incomeTotal: number;
    expenseTotal: number;
    netProfit: number;
    recordCount: number;
  }[];
  recentRecords: {
    record_type: string;
    record_date: string;
    description: string;
    amount: number;
    category: string | null;
    status: string;
  }[];
  overdueInvoices: {
    number: string;
    amount: number;
    due_date: string | null;
    delivery_status: string;
    client: string;
  }[];
};

export default function RecordsReviewAgent({ summary }: { summary: ReviewSummary }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [suggestion, setSuggestion] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function runReview() {
    setState("loading");
    setSuggestion("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/review/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });

      const data = await res.json() as { suggestion?: string; error?: string };

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
    }
  }

  return (
    <div data-testid="review-agent-section">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#14532d]">
            AI records review
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#4b8068]">
            Ask the assistant to inspect your approved records and surface what
            needs your attention. It reads only — it never changes your records
            or sends anything.
          </p>
        </div>
        <button
          type="button"
          onClick={runReview}
          disabled={state === "loading"}
          data-testid="run-review-button"
          className="inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d] disabled:opacity-50"
        >
          {state === "loading" ? "Reviewing…" : "Run review"}
        </button>
      </div>

      {state === "idle" && (
        <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-[#f7fef9] px-5 py-8 text-center">
          <p className="text-sm text-[#4b8068]">
            Press <strong>Run review</strong> to get a read-only analysis of your
            records.
          </p>
          <p className="mt-1 text-xs text-[#86a88e]">
            No data is written. Raw bank details are never sent to the AI.
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
            className="mt-3 text-xs font-semibold text-[#15803d] underline"
          >
            Try again
          </button>
        </div>
      )}

      {state === "done" && suggestion && (
        <div className="rounded-xl border border-[#bbf7d0] bg-white p-5" data-testid="review-result">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Review findings
          </p>
          <div className="prose prose-sm prose-green max-w-none text-[#14532d]">
            {suggestion.split("\n").map((line, i) => {
              const trimmed = line.trim();
              if (!trimmed) return null;
              const isBullet = trimmed.startsWith("-") || trimmed.startsWith("•") || /^\d+\./.test(trimmed);
              return (
                <p key={i} className={`${isBullet ? "pl-4" : ""} text-sm leading-6 text-[#14532d]`}>
                  {trimmed}
                </p>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[#86a88e]">
            This is an AI estimate only. Verify findings before acting. No records
            were changed.
          </p>
          <button
            type="button"
            onClick={runReview}
            className="mt-3 text-xs font-semibold text-[#15803d] underline"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
