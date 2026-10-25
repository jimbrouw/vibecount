"use client";

import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { createManualRecord } from "./actions";

type CategoryOption = {
  id: string;
  name: string;
  record_type: "income" | "expense";
};

type Props = {
  categories: CategoryOption[];
};

export default function AllowableExpenseFinder({ categories }: Props) {
  const expenseCategories = categories.filter((c) => c.record_type === "expense");
  const defaultOfficeCat =
    expenseCategories.find(
      (c) =>
        c.name.toLowerCase().includes("office") ||
        c.name.toLowerCase().includes("premises") ||
        c.name.toLowerCase().includes("admin"),
    )?.id ?? expenseCategories[0]?.id ?? "";

  const defaultPhoneCat =
    expenseCategories.find(
      (c) =>
        c.name.toLowerCase().includes("phone") ||
        c.name.toLowerCase().includes("internet") ||
        c.name.toLowerCase().includes("communication") ||
        c.name.toLowerCase().includes("office"),
    )?.id ?? expenseCategories[0]?.id ?? "";

  // Working From Home state
  const [wfhRate, setWfhRate] = useState<10 | 18 | 26>(26); // £26/mo (101+ hrs) default
  const [wfhMonths, setWfhMonths] = useState(12);
  const wfhTotalPence = wfhRate * wfhMonths * 100;

  // Phone / Broadband state
  const [phoneMonthlyPounds, setPhoneMonthlyPounds] = useState(40);
  const [businessPercent, setBusinessPercent] = useState(30);
  const phoneTotalPence = Math.round(
    phoneMonthlyPounds * 12 * (businessPercent / 100) * 100,
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <details
      className="rounded-2xl border border-[#86efac] bg-[#f0fdf4] p-5 shadow-xs"
      data-testid="allowable-expense-finder"
    >
      <summary className="cursor-pointer font-bold text-[#14532d] flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span>💡</span>
          <span>Allowable Expense Finder (Don't Overpay Tax)</span>
        </span>
        <span className="text-xs font-semibold text-[#15803d] underline">
          Check Simplified Allowances
        </span>
      </summary>

      <div className="mt-4 space-y-6 pt-3 border-t border-[#dcfce7]">
        <p className="text-xs text-[#166534] leading-relaxed">
          Many freelancers overpay tax simply because they forget simple statutory allowances. HMRC lets you claim simplified flat-rate deductions without needing complex utility bill calculations or receipts.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Card 1: Work From Home Flat Rate */}
          <form
            action={createManualRecord}
            className="flex flex-col justify-between rounded-xl border border-[#bbf7d0] bg-white p-4 space-y-4 shadow-2xs"
            data-testid="wfh-allowance-card"
          >
            <input type="hidden" name="recordType" value="expense" />
            <input type="hidden" name="recordDate" value={todayStr} />
            <input
              type="hidden"
              name="description"
              value={`HMRC Simplified Working from Home Allowance (${wfhMonths} months @ £${wfhRate}/mo)`}
            />
            <input
              type="hidden"
              name="amount"
              value={(wfhTotalPence / 100).toFixed(2)}
            />
            <input type="hidden" name="categoryId" value={defaultOfficeCat} />

            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#14532d]">
                  1. Working from Home Flat Rate
                </h4>
                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#15803d]">
                  HMRC Flat Rate
                </span>
              </div>
              <p className="mt-1 text-xs text-[#4b8068]">
                If you work from home 25+ hours a month, HMRC allows a flat deduction without utility bills.
              </p>

              <div className="mt-3 space-y-2">
                <label className="block text-[11px] font-semibold text-[#14532d]">
                  Average monthly home-working hours:
                </label>
                <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                  {[
                    { hrs: "25–50 hrs", rate: 10, label: "£10/mo" },
                    { hrs: "51–100 hrs", rate: 18, label: "£18/mo" },
                    { hrs: "101+ hrs", rate: 26, label: "£26/mo" },
                  ].map((tier) => (
                    <button
                      key={tier.rate}
                      type="button"
                      onClick={() => setWfhRate(tier.rate as 10 | 18 | 26)}
                      className={`cursor-pointer rounded-lg border p-1.5 transition ${
                        wfhRate === tier.rate
                          ? "border-[#15803d] bg-[#dcfce7] font-bold text-[#14532d]"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <p className="font-bold">{tier.label}</p>
                      <p className="text-[10px] opacity-75">{tier.hrs}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <label className="text-[11px] font-semibold text-[#14532d]">
                  Months active this tax year:
                </label>
                <select
                  value={wfhMonths}
                  onChange={(e) => setWfhMonths(Number(e.target.value))}
                  className="rounded-md border border-[#c8d4cb] p-1 text-xs"
                >
                  {[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((m) => (
                    <option key={m} value={m}>
                      {m} {m === 1 ? "month" : "months"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 rounded-lg bg-[#f0fdf4] p-3 text-right">
                <span className="text-[10px] uppercase text-[#166534] font-semibold block">
                  Annual Tax Deduction
                </span>
                <p className="text-xl font-extrabold text-[#14532d]">
                  {formatPounds(wfhTotalPence)}
                </p>
                <p className="text-[10px] text-[#4b8068] italic">
                  {amountToWords(wfhTotalPence)}
                </p>
              </div>
            </div>

            <button
              type="submit"
              data-testid="draft-wfh-allowance-btn"
              className="w-full cursor-pointer rounded-xl bg-[#15803d] py-2 text-xs font-bold text-white shadow-xs hover:bg-[#14532d] transition"
            >
              Draft {formatPounds(wfhTotalPence)} WFH Allowance for Review →
            </button>
          </form>

          {/* Card 2: Phone & Broadband Split */}
          <form
            action={createManualRecord}
            className="flex flex-col justify-between rounded-xl border border-[#bbf7d0] bg-white p-4 space-y-4 shadow-2xs"
            data-testid="phone-split-card"
          >
            <input type="hidden" name="recordType" value="expense" />
            <input type="hidden" name="recordDate" value={todayStr} />
            <input
              type="hidden"
              name="description"
              value={`Phone and broadband business proportion (${businessPercent}% of £${phoneMonthlyPounds}/mo)`}
            />
            <input
              type="hidden"
              name="amount"
              value={(phoneTotalPence / 100).toFixed(2)}
            />
            <input type="hidden" name="categoryId" value={defaultPhoneCat} />

            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#14532d]">
                  2. Phone & Broadband Split
                </h4>
                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#15803d]">
                  Proportional
                </span>
              </div>
              <p className="mt-1 text-xs text-[#4b8068]">
                If you use your mobile or home broadband for freelance work, claim your business percentage.
              </p>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[#14532d]">
                    Combined monthly bill:
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs">£</span>
                    <input
                      type="number"
                      min="10"
                      max="300"
                      value={phoneMonthlyPounds}
                      onChange={(e) => setPhoneMonthlyPounds(Number(e.target.value))}
                      className="w-16 rounded-md border border-[#c8d4cb] p-1 text-xs font-bold text-right"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-[#14532d]">
                    <span className="font-semibold">Business use: {businessPercent}%</span>
                    <span className="text-gray-400">Typical: 25%–50%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    step="5"
                    value={businessPercent}
                    onChange={(e) => setBusinessPercent(Number(e.target.value))}
                    className="w-full accent-[#15803d]"
                  />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-[#f0fdf4] p-3 text-right">
                <span className="text-[10px] uppercase text-[#166534] font-semibold block">
                  Annual Tax Deduction
                </span>
                <p className="text-xl font-extrabold text-[#14532d]">
                  {formatPounds(phoneTotalPence)}
                </p>
                <p className="text-[10px] text-[#4b8068] italic">
                  {amountToWords(phoneTotalPence)}
                </p>
              </div>
            </div>

            <button
              type="submit"
              data-testid="draft-phone-allowance-btn"
              className="w-full cursor-pointer rounded-xl bg-[#15803d] py-2 text-xs font-bold text-white shadow-xs hover:bg-[#14532d] transition"
            >
              Draft {formatPounds(phoneTotalPence)} Phone Allowance for Review →
            </button>
          </form>
        </div>

        <p className="text-[11px] text-[#4b8068] text-center">
          Clicking "Draft for Review" places the allowance into your Records Tray in <em>Review</em> state. You inspect and confirm it before it becomes part of your tax figures.
        </p>
      </div>
    </details>
  );
}
