"use client";

import { useState } from "react";

export default function RunDueDraftsButton() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function runDueDrafts() {
    setStatus("running");
    setMessage("");
    const response = await fetch("/api/invoices/repeating/run", { method: "POST" });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus("error");
      setMessage(body?.error ?? "Could not create due drafts.");
      return;
    }

    setStatus("done");
    setMessage(`${body?.createdDraftCount ?? 0} draft invoices created.`);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={runDueDrafts}
        disabled={status === "running"}
        className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d] disabled:bg-[#86a88e]"
      >
        {status === "running" ? "Creating drafts..." : "Create due drafts now"}
      </button>
      {message ? (
        <p className={`text-xs ${status === "error" ? "text-red-700" : "text-[#166534]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
