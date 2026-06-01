"use client";

import { useState } from "react";
import { formatPounds } from "@/lib/invoices/money";

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
  "Income",
  "Needs Review",
];

type ImportRow = {
  id: string;
  import_date: string;
  amount_pence: number;
  description: string;
  record_type: string;
  suggested_category: string | null;
  status: string;
};

type Props = {
  rows: ImportRow[];
  onAllActioned: () => void;
};

export default function ImportReview({ rows, onAllActioned }: Props) {
  const [states, setStates] = useState<Record<string, { status: "pending" | "approved" | "rejected"; category: string }>>(
    Object.fromEntries(
      rows.map((r) => [r.id, { status: "pending", category: r.suggested_category ?? "Uncategorised" }])
    )
  );
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const pendingCount = Object.values(states).filter((s) => s.status === "pending").length;

  async function act(id: string, action: "approve" | "reject") {
    setLoading((l) => ({ ...l, [id]: true }));
    try {
      const res = await fetch(`/api/records/import/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        setStates((prev) => ({
          ...prev,
          [id]: { ...prev[id], status: action === "approve" ? "approved" : "rejected" },
        }));
        const newPending = Object.values({ ...states, [id]: { ...states[id], status: action === "approve" ? "approved" : "rejected" } }).filter((s) => s.status === "pending").length;
        if (newPending === 0) onAllActioned();
      }
    } finally {
      setLoading((l) => ({ ...l, [id]: false }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-[#d5d0c8] bg-white">
      <div className="border-b border-[#f0ece4] px-5 py-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Review imported rows
        </p>
        <span className="text-xs text-[#4a6a5a]">{pendingCount} pending</span>
      </div>
      <ul>
        {rows.map((row) => {
          const s = states[row.id];
          const isDone = s.status !== "pending";
          return (
            <li
              key={row.id}
              className={`border-b border-[#f5f0e8] px-5 py-4 last:border-b-0 ${isDone ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a3a2a] truncate">{row.description}</p>
                  <p className="mt-0.5 text-xs text-[#4a6a5a]">
                    {row.import_date} · {formatPounds(row.amount_pence)} · {row.record_type}
                  </p>
                  {!isDone && (
                    <select
                      value={s.category}
                      onChange={(e) =>
                        setStates((prev) => ({
                          ...prev,
                          [row.id]: { ...prev[row.id], category: e.target.value },
                        }))
                      }
                      className="mt-2 h-9 rounded-lg border border-[#d5d0c8] bg-white px-2 text-sm text-[#1a3a2a] outline-none focus:border-[#2d6a4a]"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {isDone ? (
                    <span className={`text-xs font-medium ${s.status === "approved" ? "text-[#15803d]" : "text-[#9b8a7a]"}`}>
                      {s.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => act(row.id, "approve")}
                        disabled={loading[row.id]}
                        className="rounded-lg bg-[#dcfce7] px-3 py-1.5 text-xs font-semibold text-[#15803d] transition hover:bg-[#bbf7d0] disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => act(row.id, "reject")}
                        disabled={loading[row.id]}
                        className="rounded-lg bg-[#f5f0e8] px-3 py-1.5 text-xs font-semibold text-[#4a6a5a] transition hover:bg-[#e8e0d4] disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
