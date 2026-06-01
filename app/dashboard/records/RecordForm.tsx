"use client";

import { FormEvent, useState } from "react";
import { parseAmountToPence } from "@/lib/invoices/money";

const EXPENSE_CATEGORIES = [
  "Uncategorised",
  "Software",
  "Travel",
  "Equipment",
  "Phone / Internet",
  "Office Costs",
  "Subcontractors",
  "Bank Fees",
  "Meals / Subsistence",
  "Other Allowable Expense",
];

const inputClass =
  "mt-1.5 h-12 w-full rounded-lg border border-[#d5d0c8] bg-white px-3 text-base text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]";

type Props = {
  onAdded: () => void;
};

export default function RecordForm({ onAdded }: Props) {
  const [recordType, setRecordType] = useState<"income" | "expense">("expense");
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Uncategorised");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const amount_pence = parseAmountToPence(amount);
    if (amount_pence === null || amount_pence <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_type: recordType,
          record_date: date,
          amount_pence,
          description: description.trim(),
          category: recordType === "income" ? "Income" : category,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save the record.");
        return;
      }
      setAmount("");
      setDescription("");
      setCategory("Uncategorised");
      onAdded();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-[#d5d0c8] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1a3a2a]">Add a record</h2>

      {/* Type toggle */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="input-record-type-expense"
          onClick={() => setRecordType("expense")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            recordType === "expense"
              ? "bg-[#1a3a2a] text-white"
              : "border border-[#d5d0c8] text-[#4a6a5a] hover:bg-[#f0ece4]"
          }`}
        >
          Expense
        </button>
        <button
          type="button"
          data-testid="input-record-type-income"
          onClick={() => setRecordType("income")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            recordType === "income"
              ? "bg-[#1a3a2a] text-white"
              : "border border-[#d5d0c8] text-[#4a6a5a] hover:bg-[#f0ece4]"
          }`}
        >
          Income
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-[#4a6a5a]">Date</label>
          <input
            type="date"
            data-testid="input-record-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[#4a6a5a]">Amount</label>
          <div className="relative mt-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#4a6a5a]">£</span>
            <input
              type="text"
              inputMode="decimal"
              data-testid="input-record-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="h-12 w-full rounded-lg border border-[#d5d0c8] bg-white pl-7 pr-3 text-base text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium text-[#4a6a5a]">Description</label>
        <input
          type="text"
          data-testid="input-record-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={recordType === "expense" ? "e.g. Adobe Creative Cloud" : "e.g. Website project — Acme Ltd"}
          required
          className={inputClass}
        />
      </div>

      {recordType === "expense" && (
        <div className="mt-4">
          <label className="text-xs font-medium text-[#4a6a5a]">Category</label>
          <select
            data-testid="select-record-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        data-testid="btn-add-record"
        disabled={saving}
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#1a3a2a] text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:opacity-60"
      >
        {saving ? "Saving…" : `Add ${recordType}`}
      </button>
    </form>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
