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
  const [showSettings, setShowSettings] = useState(false);
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
  const accountColumn = table?.[0].findIndex((h) => h.trim().toLowerCase() === "account") ?? -1;
  const fileAccounts = accountColumn < 0 ? [] : [...new Set(table!.slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => row[accountColumn].trim()).filter(Boolean))];
  const multipleAccounts = fileAccounts.length > 1;
  const moneyIn = preview?.rows.reduce((sum, row) => sum + Math.max(0, row.signedPence), 0) ?? 0;
  const moneyOut = preview?.rows.reduce((sum, row) => sum + Math.max(0, -row.signedPence), 0) ?? 0;
  const missing = mapping ? [
    mapping.date < 0 ? "Which column contains the payment date?" : "",
    mapping.description < 0 ? "Which column describes the payment?" : "",
    (mapping.amountMode === "debit_credit" ? mapping.debit < 0 || mapping.credit < 0 : mapping.amount < 0)
      ? "Which column contains the money amount?" : "",
  ].filter(Boolean) : [];
  const previewError = missing.length ? missing.join(" ") : preview?.error;
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
    setShowSettings(false);
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
      const suggested = suggestMapping(parsed[0], provider);
      if (suggested.date >= 0 && parsed.slice(1).filter((row) => row.some((cell) => cell.trim()))
        .every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row[suggested.date].trim()))) {
        suggested.dateFormat = "iso";
      }
      setMapping(suggested);
    } catch (e) {
      if (generation === readGeneration.current)
        setError(e instanceof Error ? e.message : "Could not read CSV.");
    }
  }

  const accountElement = (
<label className="block" htmlFor="source-account">
        Which account is this file from?
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
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · ending {a.masked_identifier}
            </option>
          ))}
        </select>
      </label>
  );

  return (
    <form
      action={importSourceCsv}
      data-testid="source-import-form"
      className="space-y-5 rounded-xl border bg-white p-5"
    >
      <h2 className="text-xl font-semibold">Import your payments</h2>
      <p className="text-sm font-semibold">1. Choose a file → 2. Check the preview → 3. Import for review</p>
      <p className="text-sm">
        Choose a bank, card or expenses CSV. You will review the payments before
        they count as income or expenses. Nothing is approved here.
      </p>
      <label className="block" htmlFor="source-file">
        Choose your CSV file (up to 1 MB)
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
        <details open={showSettings || Boolean(previewError)}
          onToggle={(event) => setShowSettings(event.currentTarget.open)}
          className="rounded-lg border p-4" data-testid="source-settings">
          <summary className="cursor-pointer font-semibold" data-testid="source-settings-toggle">Change how this file is read</summary>
          <p className="my-3 text-sm">Only change these if the preview looks wrong. Choose the column from your file for each item.</p>
        <fieldset
          className="grid gap-4 sm:grid-cols-2"
          data-testid="source-mapping-fields"
        >
          <legend className="sr-only">File columns</legend>
          {(
            [
              ["date", "Date"],
              ["description", "Description / counterparty"],
              ["amount", "Money amount"],
              ["debit", "Money paid out (separate column)"],
              ["credit", "Money received (separate column)"],
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
                <option value={-1}>Choose a column</option>
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
            How are amounts shown?
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
                Positive = money out; negative = money in
              </option>
            </select>
          </label>
        </fieldset>
        </details>
      )}
      {error || previewError ? (
        <p
          role="alert"
          className="text-red-800"
          data-testid="source-preview-error"
        >
          {error || previewError}
        </p>
      ) : null}
      {preview && !preview.error && preview.rows.length > 0 && (
        <div
          data-testid="source-preview"
          className="space-y-3 rounded-md bg-[#f2f6f2] p-4"
        >
          <h3 className="text-lg font-semibold">2. Does this look right?</h3>
          <p>We found {preview.rows.length} payments, from {dates[0]} to {dates.at(-1)}.</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="font-semibold">Money paid out</dt><dd>{formatPounds(moneyOut)} ({amountToWords(moneyOut)})</dd></div>
            <div><dt className="font-semibold">Money received</dt><dd>{formatPounds(moneyIn)} ({amountToWords(moneyIn)})</dd></div>
          </dl>
          <p className="text-sm">These are file totals in pounds, before business-use decisions. Existing spreadsheet labels do not approve any payment.</p>
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
          {multipleAccounts ? (
            <div role="alert" data-testid="source-multiple-accounts" className="rounded-md border border-amber-300 bg-amber-50 p-4">
              <p className="font-semibold">This file combines {fileAccounts.length} accounts.</p>
              <p className="mt-2">You can check the preview, but this importer needs one account per file. Upload the original CSV from each bank or card separately so payments keep the right source. We have not imported anything from this file.</p>
            </div>
          ) : accountElement}
          {!multipleAccounts && <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="mappingConfirmed"
              value="yes"
              checked={confirmed}
              required
              data-testid="source-mapping-confirm"
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            The account, dates and money in/out look right. Save the original securely and add these payments for review.
          </label>}
        </div>
      )}
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <button
        type="submit"
        data-testid="source-import-submit"
        disabled={
          !accountId ||
          multipleAccounts ||
          !confirmed ||
          !preview?.rows.length ||
          Boolean(preview.error)
        }
        className="rounded-md bg-[#15803d] px-4 py-2 font-semibold text-white disabled:opacity-40"
      >
        3. Import for review
      </button>
    </form>
  );
}
