"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DocumentIntake({
  currentYear,
}: {
  currentYear: number;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return (
    <section
      className="rounded-xl border bg-white p-4"
      aria-labelledby="document-intake-heading"
    >
      <h2 id="document-intake-heading" className="font-semibold">
        Preserve invoice, receipt or employment evidence
      </h2>
      <p className="my-2 text-sm">
        Upload a PDF, PNG or JPEG up to 3 MB. Invoice ZIPs may contain up to 100
        entries and 10 MB of PDFs after expansion. Every file must validate
        before the upload is preserved.
      </p>
      <p className="my-2 text-sm">
        Evidence stays unresolved. This step does not extract tax facts, approve
        expenses or mark invoices paid. Original contents and filenames are
        encrypted and are not shown to AI or browser agents.
      </p>
      <form
        data-testid="document-intake-form"
        className="mt-3 space-y-3"
        onChange={() => {
          setConfirmed(false);
          setMessage("");
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!confirmed || busy) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          setBusy(true);
          setMessage("");
          setFailed(false);
          try {
            const response = await fetch("/api/evidence/intake", {
              method: "POST",
              body: data,
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error || "Could not preserve evidence.");
            setMessage(
              result.created
                ? "Evidence preserved as unresolved. Review it before using any figures."
                : "This evidence already exists for that purpose and tax year. No duplicate documents were added.",
            );
            form.reset();
            setConfirmed(false);
            router.refresh();
          } catch (error) {
            setFailed(true);
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not preserve evidence.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="space-y-3">
          <label className="block" htmlFor="evidence-document">
            Evidence file
            <input
              className="mt-1 block w-full"
              id="evidence-document"
              name="document"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.zip"
              required
              data-testid="document-intake-file"
            />
          </label>
          <label className="block" htmlFor="evidence-purpose">
            Document purpose
            <select
              className="ml-2 rounded border p-2"
              id="evidence-purpose"
              name="purpose"
              required
              data-testid="document-intake-purpose"
            >
              <option value="invoice">Invoice evidence</option>
              <option value="receipt">Receipt evidence</option>
              <option value="employment">
                Employment, P45 or redundancy evidence
              </option>
              <option value="other">Other evidence</option>
            </select>
          </label>
          <label className="block" htmlFor="evidence-year">
            Tax year starting 6 April
            <input
              className="ml-2 w-28 rounded border p-2"
              id="evidence-year"
              name="taxYearStart"
              type="number"
              min="2000"
              max="2100"
              step="1"
              defaultValue={currentYear}
              required
              data-testid="document-intake-year"
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="preserveConfirmed"
              value="yes"
              checked={confirmed}
              required
              data-testid="document-intake-confirm"
              onChange={(e) => {
                e.stopPropagation();
                setConfirmed(e.target.checked);
              }}
            />
            <span>
              I confirm the selected purpose and tax year, and want to preserve
              this evidence for later review.
            </span>
          </label>
          <button
            type="submit"
            disabled={!confirmed || busy}
            data-testid="document-intake-submit"
            className="rounded bg-[#14532d] px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "Preserving evidence…" : "Preserve unresolved evidence"}
          </button>
        </fieldset>
      </form>
      {message && (
        <p
          className="mt-3"
          role={failed ? "alert" : "status"}
          data-testid="document-intake-result"
        >
          {message}
        </p>
      )}
    </section>
  );
}
