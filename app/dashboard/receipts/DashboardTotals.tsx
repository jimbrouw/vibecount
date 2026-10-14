"use client";
import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import ReceiptImporter from "./ReceiptImporter";

export default function DashboardTotals({ invoiced, paid, outstanding, expenses, awaitingReview, taxPot, percentage, expenseError }: {
  invoiced: number; paid: number; outstanding: number; expenses: number; awaitingReview: number; taxPot: number; percentage: number; expenseError: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <div className="mb-8">
    <p className="mb-3 text-xs text-[#4b8068]">All-time totals · Expenses: approved paid GBP business costs, less linked refunds. Tax-year detail is in Records.</p>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Dashboard totals">
      {[{ label: "Total invoiced", value: invoiced }, { label: "Total paid", value: paid }, { label: "Outstanding", value: outstanding }].map(t => <div key={t.label} className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">{t.label}</p><p className="mt-2 text-xl font-semibold text-[#14532d]">{formatPounds(t.value)}</p></div>)}
      <button type="button" aria-expanded={open} aria-controls="dashboard-expense-panel" onClick={() => setOpen(!open)} data-testid="dashboard-expenses-bucket" className="rounded-xl border border-[#bbf7d0] bg-white p-5 text-left shadow-sm hover:bg-[#f7fef9]">
        <span className="block text-xs font-semibold uppercase tracking-widest text-[#166534]">Expenses</span>
        <span className="mt-2 block text-xl font-semibold text-[#14532d]" data-testid="dashboard-expense-total">{expenseError ? "Unavailable — retry" : formatPounds(expenses)}</span>
        {!expenseError && <span className="mt-1 block text-xs text-[#4b8068]">{expenses < 0 ? `minus ${amountToWords(-expenses)}` : amountToWords(expenses)}</span>}
        <span className="mt-2 block text-xs text-[#4b8068]">{expenseError ? "Open to retry loading" : `${awaitingReview} awaiting review`} · {open ? "Close" : "Open"} receipts</span>
      </button>
      <div className="rounded-xl border border-[#dcfce7] bg-[#f7fef9] p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Tax pot nudge</p><p className="mt-2 text-xl font-semibold text-[#14532d]">{formatPounds(taxPot)}</p><p className="mt-1 text-xs text-[#4b8068]">{percentage}% of paid invoices</p></div>
    </section>
    <div id="dashboard-expense-panel" hidden={!open} className="mt-4">{open && <ReceiptImporter />}</div>
  </div>;
}
