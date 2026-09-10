"use client";

import { useState } from "react";

export default function QuoteDateFields({ initialDate }: { initialDate: string }) {
  const [quoteDate, setQuoteDate] = useState(initialDate);

  return (
    <>
      <FieldShell label="Quote date">
        <input
          name="quoteDate"
          type="date"
          value={quoteDate}
          onChange={(event) => setQuoteDate(event.target.value)}
          className={inputCls}
          required
        />
      </FieldShell>
      <FieldShell label="Valid until">
        <input
          name="validUntil"
          type="date"
          value={addDays(quoteDate, 30)}
          readOnly
          className={inputCls}
          required
        />
      </FieldShell>
    </>
  );
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">{label}</span>
      {children}
    </label>
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]";
