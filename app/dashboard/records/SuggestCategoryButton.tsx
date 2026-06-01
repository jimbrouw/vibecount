"use client";

import { useRef, useState } from "react";
import { applyRecordCategory } from "./actions";

type Suggestion = {
  categoryId: string;
  categoryName: string;
  reason: string;
};

export default function SuggestCategoryButton({ recordId }: { recordId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "suggested" | "error">("idle");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSuggest(e: React.MouseEvent) {
    e.stopPropagation();
    setState("loading");
    setSuggestion(null);
    setErrorMsg("");

    try {
      const res = await fetch(
        `/api/records/suggest-category?recordId=${encodeURIComponent(recordId)}`
      );
      const data = await res.json() as Suggestion & { error?: string };

      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? "Suggestion failed. Try again.");
        setState("error");
        return;
      }

      setSuggestion({ categoryId: data.categoryId, categoryName: data.categoryName, reason: data.reason });
      setState("suggested");
    } catch {
      setErrorMsg("Could not reach the suggestion service.");
      setState("error");
    }
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setState("idle");
    setSuggestion(null);
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={handleSuggest}
        data-testid={`suggest-category-button-${recordId}`}
        className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-white px-2.5 py-0.5 text-xs font-medium text-[#4b8068] transition hover:border-[#86efac] hover:text-[#14532d]"
      >
        Suggest category
      </button>
    );
  }

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#f7fef9] px-2.5 py-0.5 text-xs text-[#4b8068]">
        Thinking…
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e0b4a7] bg-[#fff7f3] px-2.5 py-0.5 text-xs text-[#7a271a]">
        {errorMsg}
        <button
          type="button"
          onClick={handleSuggest}
          className="underline"
        >
          Retry
        </button>
      </span>
    );
  }

  if (state === "suggested" && suggestion) {
    return (
      <span
        onClick={(e) => e.stopPropagation()}
        className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1.5 text-xs text-[#14532d]"
        data-testid={`suggestion-result-${recordId}`}
      >
        <span>
          <strong>{suggestion.categoryName}</strong>
          {suggestion.reason ? ` — ${suggestion.reason}` : ""}
        </span>
        <form
          ref={formRef}
          action={applyRecordCategory}
          onClick={(e) => e.stopPropagation()}
        >
          <input type="hidden" name="recordId" value={recordId} />
          <input type="hidden" name="categoryId" value={suggestion.categoryId} />
          <button
            type="submit"
            data-testid={`accept-category-button-${recordId}`}
            className="rounded-md bg-[#15803d] px-2 py-0.5 font-semibold text-white transition hover:bg-[#14532d]"
          >
            Accept
          </button>
        </form>
        <button
          type="button"
          onClick={handleDismiss}
          data-testid={`dismiss-category-button-${recordId}`}
          className="text-[#4b8068] underline"
        >
          Dismiss
        </button>
      </span>
    );
  }

  return null;
}
