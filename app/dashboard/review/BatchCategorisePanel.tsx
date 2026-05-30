"use client";

import { useRef, useState } from "react";
import { applyBatchCategories } from "@/app/dashboard/records/actions";
import { formatPounds } from "@/lib/invoices/money";

type Suggestion = {
  recordId: string;
  description: string;
  amount: number;
  recordType: string;
  categoryId: string;
  categoryName: string;
  reason: string;
};

export default function BatchCategorisePanel({ uncategorisedCount }: { uncategorisedCount: number }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  if (uncategorisedCount === 0) return null;

  async function loadSuggestions() {
    setState("loading");
    setSuggestions([]);
    setErrorMsg("");

    try {
      const res = await fetch("/api/records/batch-suggest-categories");
      const data = await res.json() as { suggestions?: Suggestion[]; error?: string };

      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? "Suggestion failed. Try again.");
        setState("error");
        return;
      }

      const list = data.suggestions ?? [];
      setSuggestions(list);
      setChecked(Object.fromEntries(list.map((s) => [s.recordId, true])));
      setState("ready");
    } catch {
      setErrorMsg("Could not reach the suggestion service.");
      setState("error");
    }
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="mt-6 rounded-xl border border-[#bbf7d0] bg-white p-5" data-testid="batch-categorise-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#14532d]">Batch categorise</h2>
          <p className="mt-1 text-sm leading-6 text-[#4b8068]">
            {uncategorisedCount} record{uncategorisedCount === 1 ? "" : "s"} without a category.
            Let the AI suggest categories for all of them at once — you choose which to accept.
          </p>
        </div>
        {state !== "ready" && (
          <button
            type="button"
            onClick={loadSuggestions}
            disabled={state === "loading"}
            data-testid="batch-suggest-button"
            className="inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4] disabled:opacity-50"
          >
            {state === "loading" ? "Thinking…" : "Suggest all"}
          </button>
        )}
      </div>

      {state === "error" && (
        <div className="mt-4 rounded-lg border border-[#e0b4a7] bg-[#fff7f3] px-4 py-3 text-sm text-[#7a271a]">
          {errorMsg}
          <button type="button" onClick={loadSuggestions} className="ml-2 underline">Retry</button>
        </div>
      )}

      {state === "ready" && suggestions.length === 0 && (
        <p className="mt-4 text-sm text-[#4b8068]">
          No suggestions could be generated. Open each record and pick a category manually.
        </p>
      )}

      {state === "ready" && suggestions.length > 0 && (
        <form ref={formRef} action={applyBatchCategories} className="mt-4" data-testid="batch-apply-form">
          <div className="overflow-x-auto rounded-lg border border-[#dcfce7]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#dcfce7] bg-[#f0fdf4]">
                  <th className="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selectedCount === suggestions.length}
                      onChange={(e) =>
                        setChecked(Object.fromEntries(suggestions.map((s) => [s.recordId, e.target.checked])))
                      }
                      className="h-4 w-4 accent-[#15803d]"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[#166534]">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-[#166534]">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[#166534]">Suggested category</th>
                  <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[#166534] sm:table-cell">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0fdf4]">
                {suggestions.map((s) => (
                  <tr
                    key={s.recordId}
                    className={`transition ${checked[s.recordId] ? "bg-white" : "bg-[#f7fef9] opacity-50"}`}
                    data-testid={`batch-row-${s.recordId}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`apply-${s.recordId}`}
                        value={s.categoryId}
                        checked={!!checked[s.recordId]}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [s.recordId]: e.target.checked }))
                        }
                        aria-label={`Apply ${s.categoryName} to ${s.description}`}
                        data-testid={`batch-checkbox-${s.recordId}`}
                        className="h-4 w-4 accent-[#15803d]"
                      />
                    </td>
                    <td className="px-3 py-2 text-[#14532d]">
                      <p className="font-medium">{s.description}</p>
                      <p className="text-xs capitalize text-[#4b8068]">{s.recordType}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-[#14532d]">
                      {s.recordType === "expense" ? "-" : ""}
                      {formatPounds(Math.round(s.amount * 100))}
                    </td>
                    <td className="px-3 py-2 font-medium text-[#14532d]">{s.categoryName}</td>
                    <td className="hidden px-3 py-2 text-xs text-[#4b8068] sm:table-cell">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-[#4b8068]">
              {selectedCount} of {suggestions.length} selected. Only ticked rows will be categorised.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setState("idle")}
                className="rounded-lg border border-[#bbf7d0] bg-white px-4 py-2 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={selectedCount === 0}
                data-testid="batch-apply-button"
                className="rounded-lg bg-[#15803d] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#14532d] disabled:opacity-40"
              >
                Apply {selectedCount} categor{selectedCount === 1 ? "y" : "ies"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
