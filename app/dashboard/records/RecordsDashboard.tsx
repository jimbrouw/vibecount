"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPounds } from "@/lib/invoices/money";
import RecordForm from "./RecordForm";
import ImportReview from "./ImportReview";

type Quarter = {
  quarter: number;
  label: string;
  income_pence: number;
  expenses_pence: number;
  net_profit_pence: number;
};

type TaxEstimate = {
  income_tax_pence: number;
  ni_class4_pence: number;
  total_estimated_tax_pence: number;
  disclaimer: string;
};

type Summary = {
  tax_year: string;
  income_pence: number;
  expenses_pence: number;
  net_profit_pence: number;
  tax_estimate: TaxEstimate;
  mtd_threshold_pence: number | null;
  mtd_threshold_label: string;
  quarters: Quarter[];
};

type ImportRow = {
  id: string;
  import_date: string;
  amount_pence: number;
  description: string;
  record_type: string;
  suggested_category: string | null;
  status: string;
};

export default function RecordsDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState("");
  const [bankImporting, setBankImporting] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/records/summary").catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (data) setSummary(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/records/summary")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setSummary(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError("");
    try {
      const text = await file.text();
      const res = await fetch("/api/records/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed.");
        return;
      }
      setImportRows(data.staged ?? []);
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function handleBankUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankImporting(true);
    setImportError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/records/bank-import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Bank import failed.");
        return;
      }
      setImportRows((prev) => [...prev, ...(data.staged ?? [])]);
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setBankImporting(false);
      e.target.value = "";
    }
  }

  const mtdPercent = summary && summary.mtd_threshold_pence
    ? Math.min(100, Math.round((summary.income_pence / summary.mtd_threshold_pence) * 100))
    : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1a3a2a]">Records</h1>
          <p className="mt-1 text-sm text-[#4a6a5a]">
            Log income and expenses. All figures are estimates — verify with your accountant.
          </p>
        </div>
        <a
          href="/api/records/export"
          download
          className="hidden sm:inline-flex h-9 items-center rounded-lg border border-[#d5d0c8] bg-white px-4 text-xs font-semibold text-[#4a6a5a] transition hover:bg-[#f0ece4]"
        >
          Export CSV
        </a>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            { label: "Income", pence: summary.income_pence, color: "text-[#15803d]" },
            { label: "Expenses", pence: summary.expenses_pence, color: "text-[#92400e]" },
            { label: "Net profit (estimate)", pence: summary.net_profit_pence, color: "text-[#1a3a2a]" },
          ].map(({ label, pence, color }) => (
            <div key={label} className="rounded-xl border border-[#d5d0c8] bg-white p-4">
              <p className="text-xs text-[#4a6a5a]">{label}</p>
              <p className={`mt-1 text-lg font-semibold ${color}`}>{formatPounds(pence)}</p>
              <p className="text-xs text-[#4a6a5a]">{summary.tax_year}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tax estimate */}
      {summary && (
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Tax estimate</p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-[#4a6a5a]">Estimated income tax</p>
              <p className="font-semibold text-[#1a3a2a]">{formatPounds(summary.tax_estimate.income_tax_pence)}</p>
            </div>
            <div>
              <p className="text-xs text-[#4a6a5a]">Estimated Class 4 NI</p>
              <p className="font-semibold text-[#1a3a2a]">{formatPounds(summary.tax_estimate.ni_class4_pence)}</p>
            </div>
            <div>
              <p className="text-xs text-[#4a6a5a]">Total estimated tax</p>
              <p className="font-semibold text-[#1a3a2a]">{formatPounds(summary.tax_estimate.total_estimated_tax_pence)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#4a6a5a]">{summary.tax_estimate.disclaimer}</p>
        </div>
      )}

      {/* MTD threshold */}
      {summary && mtdPercent !== null && (
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">MTD progress</p>
            <span className="text-xs text-[#4a6a5a]">{mtdPercent}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#f0ece4]">
            <div
              className={`h-2 rounded-full transition-all ${mtdPercent >= 90 ? "bg-red-400" : mtdPercent >= 70 ? "bg-amber-400" : "bg-[#15803d]"}`}
              style={{ width: `${mtdPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-[#4a6a5a]">{summary.mtd_threshold_label}</p>
        </div>
      )}

      {/* Quarterly breakdown */}
      {summary && summary.quarters.length > 0 && (
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white">
          <div className="border-b border-[#f0ece4] px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Quarterly breakdown</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f0ece4]">
                <th className="px-5 py-2 text-left text-xs font-medium text-[#4a6a5a]">Quarter</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-[#4a6a5a]">Income</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-[#4a6a5a]">Expenses</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-[#4a6a5a]">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {summary.quarters.map((q) => (
                <tr key={q.quarter} className="border-b border-[#f5f0e8] last:border-0">
                  <td className="px-5 py-3 text-xs text-[#1a3a2a]">{q.label}</td>
                  <td className="px-5 py-3 text-right text-xs font-medium text-[#15803d]">{formatPounds(q.income_pence)}</td>
                  <td className="px-5 py-3 text-right text-xs font-medium text-[#92400e]">{formatPounds(q.expenses_pence)}</td>
                  <td className="px-5 py-3 text-right text-xs font-semibold text-[#1a3a2a]">{formatPounds(q.net_profit_pence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && !summary && (
        <div className="mb-6 rounded-xl border border-dashed border-[#d5d0c8] p-8 text-center text-sm text-[#4a6a5a]">
          Loading…
        </div>
      )}

      {/* Add record form */}
      <RecordForm onAdded={loadSummary} />

      {/* Import section */}
      <div className="mt-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
        <p className="text-sm font-semibold text-[#1a3a2a]">Import records</p>
        <p className="mt-1 text-xs text-[#4a6a5a]">
          CSV columns: <code className="rounded bg-[#f5f0e8] px-1">date, amount, description, type</code> (type = income or expense)
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#d5d0c8] bg-white px-4 text-xs font-semibold text-[#4a6a5a] transition hover:bg-[#f0ece4]">
            {importing ? "Importing…" : "Upload CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} disabled={importing} />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#d5d0c8] bg-white px-4 text-xs font-semibold text-[#4a6a5a] transition hover:bg-[#f0ece4]">
            {bankImporting ? "Processing…" : "Upload bank statement PDF"}
            <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleBankUpload} disabled={bankImporting} />
          </label>
        </div>
        {importError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{importError}</p>
        )}
      </div>

      {/* Import review */}
      {importRows.length > 0 && (
        <ImportReview rows={importRows} onAllActioned={loadSummary} />
      )}
    </div>
  );
}
