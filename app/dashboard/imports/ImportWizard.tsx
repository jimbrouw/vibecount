"use client";

import { useMemo, useRef, useState } from "react";
import {
  normalizeSourceCsv,
  readSourceCsv,
  suggestMapping,
  MAX_SOURCE_BYTES,
  type CsvMapping,
} from "@/lib/records/source-csv";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import { importSourceCsv } from "./actions";

export type AccountOption = {
  id: string;
  label: string;
  provider: string;
  masked_identifier: string;
};
const control =
  "mt-1 block w-full rounded-md border border-[#c8d4cb] bg-white p-2 text-sm";

export default function ImportWizard({
  accounts,
}: {
  accounts: AccountOption[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const readGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => {
    if (!table || !mapping) return null;
    try {
      return { rows: normalizeSourceCsv(table, mapping), error: "" };
    } catch (e) {
      return {
        rows: [],
        error: e instanceof Error ? e.message : "Check mapping.",
      };
    }
  }, [table, mapping]);
  const dates = preview?.rows.map((r) => r.date).sort() ?? [];
  function patch(values: Partial<CsvMapping>) {
    setConfirmed(false);
    setMapping((m) => (m ? { ...m, ...values } : m));
  }
  async function loadFile(file: File | undefined, provider: string) {
    const generation = ++readGeneration.current;
    setConfirmed(false);
    setTable(null);
    setMapping(null);
    setError("");
    if (!file) return;
    try {
      if (file.size > MAX_SOURCE_BYTES || !file.size)
        throw new Error("Choose a non-empty CSV no larger than 1 MB.");
      const parsed = readSourceCsv(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
      if (generation !== readGeneration.current) return;
      setTable(parsed);
      setMapping(suggestMapping(parsed[0], provider));
    } catch (e) {
      if (generation === readGeneration.current)
        setError(e instanceof Error ? e.message : "Could not read CSV.");
    }
  }

  return (
    <form
      action={importSourceCsv}
      data-testid="source-import-form"
      className="space-y-5 rounded-xl border bg-white p-5"
    >
      <h2 className="text-lg font-semibold">Import a bank or card CSV</h2>
      <p className="text-sm">
        Importing creates transactions for review. It does not add income or
        expenses to your approved records.
      </p>
      <label className="block" htmlFor="source-account">
        Account label
        <select
          id="source-account"
          name="accountId"
          data-testid="source-account-select"
          value={accountId}
          required
          className={control}
          onChange={(e) => {
            setAccountId(e.target.value);
            void loadFile(
              fileInput.current?.files?.[0],
              accounts.find((a) => a.id === e.target.value)?.provider ??
                "generic",
            );
          }}
        >
          <option value="">Choose account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · ending {a.masked_identifier}
            </option>
          ))}
        </select>
      </label>
      <label className="block" htmlFor="source-file">
        CSV file (UTF-8, up to 1 MB)
        <input
          ref={fileInput}
          id="source-file"
          name="sourceFile"
          type="file"
          accept=".csv,text/csv"
          required
          data-testid="source-file-input"
          className={control}
          onChange={(e) => {
            void loadFile(
              e.target.files?.[0],
              accounts.find((a) => a.id === accountId)?.provider ?? "generic",
            );
          }}
        />
      </label>
      {table && mapping && (
        <fieldset
          className="grid gap-4 sm:grid-cols-2"
          data-testid="source-mapping-fields"
        >
          <legend className="font-semibold">Check field mapping</legend>
          {(
            [
              ["date", "Date"],
              ["description", "Description / counterparty"],
              ["amount", "Signed amount"],
              ["debit", "Money out / debit"],
              ["credit", "Money in / credit"],
              ["currency", "Currency (optional)"],
              ["reference", "Reference (optional)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} htmlFor={`mapping-${key}`}>
              {label}
              <select
                id={`mapping-${key}`}
                value={mapping[key]}
                data-testid={`source-mapping-${key}`}
                className={control}
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
              >
                <option value={-1}>Not mapped</option>
                {table[0].map((h, i) => (
                  <option value={i} key={i}>
                    {redactBankDetailsForPrompt(h).slice(0, 100)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label htmlFor="mapping-date-format">
            Date format
            <select
              id="mapping-date-format"
              data-testid="source-date-format"
              value={mapping.dateFormat}
              className={control}
              onChange={(e) =>
                patch({
                  dateFormat: e.target.value as CsvMapping["dateFormat"],
                })
              }
            >
              <option value="dmy">DD/MM/YYYY</option>
              <option value="iso">YYYY-MM-DD</option>
            </select>
          </label>
          <label htmlFor="mapping-sign">
            Amount meaning
            <select
              id="mapping-sign"
              data-testid="source-amount-mode"
              value={mapping.amountMode}
              className={control}
              onChange={(e) =>
                patch({
                  amountMode: e.target.value as CsvMapping["amountMode"],
                })
              }
            >
              <option value="signed">
                Positive = money in; negative = money out
              </option>
              <option value="debit_credit">
                Separate positive debit and credit columns
              </option>
              <option value="card_charges">
                Card: positive = purchase; negative = repayment/refund
              </option>
            </select>
          </label>
        </fieldset>
      )}
      {error || preview?.error ? (
        <p
          role="alert"
          className="text-red-800"
          data-testid="source-preview-error"
        >
          {error || preview?.error}
        </p>
      ) : null}
      {preview && !preview.error && preview.rows.length > 0 && (
        <div
          data-testid="source-preview"
          className="space-y-3 rounded-md bg-[#f2f6f2] p-4"
        >
          <p>
            {preview.rows.length} transactions · {dates[0]} to {dates.at(-1)} ·
            GBP
          </p>
          <p className="text-sm">
            First five transactions. Check that receipts are money in and
            purchases are money out. Card repayments still need transfer review.
          </p>
          <ul className="space-y-2">
            {preview.rows.slice(0, 5).map((r) => (
              <li key={r.rowNumber}>
                Row {r.rowNumber} · {r.date} · {r.description} ·{" "}
                {r.signedPence > 0 ? "In" : "Out"}{" "}
                {formatPounds(Math.abs(r.signedPence))} (
                {amountToWords(Math.abs(r.signedPence))})
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="mappingConfirmed"
              value="yes"
              checked={confirmed}
              required
              data-testid="source-mapping-confirm"
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm the selected account, dates, GBP currency and direction of
            the amounts. Preserve the encrypted original and import for review.
          </label>
        </div>
      )}
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <button
        type="submit"
        data-testid="source-import-submit"
        disabled={
          !accountId ||
          !confirmed ||
          !preview?.rows.length ||
          Boolean(preview.error)
        }
        className="rounded-md bg-[#15803d] px-4 py-2 font-semibold text-white disabled:opacity-40"
      >
        Preserve source and import for review
      </button>
    </form>
  );
}
