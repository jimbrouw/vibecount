"use client";

import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import {
  calculateCashBuckets,
  evaluateWhatIf,
  type CashBucketResult,
} from "@/lib/finance/cash-buckets";

type Props = {
  actualCashPence: number | null;
  liabilitiesPence: number | null;
  actualTaxReservePence: number | null;
  requiredTaxProtectionPence: number | null;
  currentFreeCashPence: number | null;
  monthlyCostsPence: number | null;
  monthlyDrawingsPence: number | null;
  unpaidInvoicesPence?: number | null;
};

export default function CashBucketsView(props: Props) {
  const buckets = calculateCashBuckets(props);

  // What-If Sandbox State
  const [showSandbox, setShowSandbox] = useState(false);
  const [drawingsPounds, setDrawingsPounds] = useState(0);
  const [equipmentPounds, setEquipmentPounds] = useState(0);
  const [invoicePaid, setInvoicePaid] = useState(false);

  const whatIf = evaluateWhatIf({
    baseSafePence: buckets.safeToSpendPence,
    baseTaxPence: buckets.taxProtectionPence,
    baseMonthlyBurnPence: buckets.monthlyBurnPence,
    drawingsAdjustmentPence: drawingsPounds * 100,
    equipmentPurchasePence: equipmentPounds * 100,
    incomingInvoicePaidPence: invoicePaid ? buckets.unpaidInvoicesPence : 0,
  });

  const weatherIcons = {
    comfortable: "☀️",
    stable: "⛅",
    tight: "🌧️",
    unknown: "📋",
  };

  const weatherColors = {
    comfortable: "bg-[#ecfdf5] border-[#a7f3d0] text-[#065f46]",
    stable: "bg-[#fefce8] border-[#fef08a] text-[#854d0e]",
    tight: "bg-[#fff1f2] border-[#fecdd3] text-[#9f1239]",
    unknown: "bg-white border-gray-200 text-gray-700",
  };

  return (
    <section className="space-y-6" data-testid="cash-buckets-view">
      {/* 3-Bucket Header Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Bucket 1: Safe to Spend */}
        <div
          className="flex flex-col justify-between rounded-2xl border-2 border-[#86efac] bg-[#f0fdf4] p-5 shadow-xs"
          data-testid="bucket-safe-to-spend"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#166534]">
                1. Safe to Spend
              </span>
              <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-xs font-semibold text-[#15803d]">
                Yours to keep
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-[#14532d]">
              {formatPounds(buckets.safeToSpendPence)}
            </p>
            <p className="mt-1 text-xs text-[#166534] italic">
              {amountToWords(buckets.safeToSpendPence)}
            </p>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[#166534]">
            Free cash you can draw or spend on personal life without touching tax money or debts.
          </p>
        </div>

        {/* Bucket 2: Tax & Debt Protection */}
        <div
          className="flex flex-col justify-between rounded-2xl border-2 border-[#fed7aa] bg-[#fffaf5] p-5 shadow-xs"
          data-testid="bucket-tax-protection"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#9a3412]">
                2. Tax & Debt Pot
              </span>
              <span className="rounded-full bg-[#ffedd5] px-2 py-0.5 text-xs font-semibold text-[#c2410c]">
                Hands off
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-[#7c2d12]">
              {formatPounds(buckets.taxProtectionPence)}
            </p>
            <p className="mt-1 text-xs text-[#9a3412] italic">
              {amountToWords(buckets.taxProtectionPence)}
            </p>
          </div>
          <div>
            {buckets.taxNudgePence > 0 ? (
              <div className="mt-3 rounded-lg border border-[#fdba74] bg-[#ffedd5] p-2 text-xs font-medium text-[#9a3412]">
                💡 Nudge: Move {formatPounds(buckets.taxNudgePence)} into your Tax Pot Space today.
              </div>
            ) : (
              <p className="mt-4 text-xs leading-relaxed text-[#9a3412]">
                Protected for your upcoming Self Assessment tax, National Insurance, and card balances.
              </p>
            )}
          </div>
        </div>

        {/* Bucket 3: Coming In Soon */}
        <div
          className="flex flex-col justify-between rounded-2xl border-2 border-[#bfdbfe] bg-[#eff6ff] p-5 shadow-xs"
          data-testid="bucket-unpaid-invoices"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1e40af]">
                3. Coming In Soon
              </span>
              <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-xs font-semibold text-[#2563eb]">
                Unpaid invoices
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-[#1e3a8a]">
              {formatPounds(buckets.unpaidInvoicesPence)}
            </p>
            <p className="mt-1 text-xs text-[#1e40af] italic">
              {amountToWords(buckets.unpaidInvoicesPence)}
            </p>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[#1e40af]">
            Pending payments from clients. When paid, ~80% flows directly into your Safe to Spend pot.
          </p>
        </div>
      </div>

      {/* Weather Forecast Runway Banner */}
      <div
        className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${
          weatherColors[buckets.runwayStatus]
        }`}
        data-testid="runway-forecast-banner"
      >
        <div className="flex items-center gap-4">
          <span className="text-4xl" role="img" aria-label="weather status">
            {weatherIcons[buckets.runwayStatus]}
          </span>
          <div>
            <h3 className="text-lg font-bold">
              {buckets.summaryHeadline}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed opacity-90">
              {buckets.summaryDescription}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowSandbox((prev) => !prev)}
          data-testid="toggle-what-if-sandbox"
          className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-xl border border-current bg-white/70 px-4 py-2 text-xs font-bold shadow-xs transition hover:bg-white sm:self-center"
        >
          {showSandbox ? "Hide 'What-If' Test" : "⚡ Test a Financial Decision"}
        </button>
      </div>

      {/* Interactive What-If Sandbox Playground */}
      {showSandbox && (
        <div
          className="rounded-2xl border-2 border-dashed border-[#15803d] bg-white p-6 shadow-sm"
          data-testid="what-if-sandbox"
        >
          <div className="border-b border-gray-100 pb-3">
            <h3 className="text-base font-bold text-[#14532d]">
              Financial Decision Sandbox ("What-If?")
            </h3>
            <p className="mt-1 text-xs text-[#4b8068]">
              Test taking extra drawings or buying gear safely. This is an exploration tool — it does not modify your official records or bank accounts.
            </p>
          </div>

          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            {/* Slider 1: Extra drawings */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#14532d]">
                Take personal drawings: £{drawingsPounds}
              </label>
              <input
                type="range"
                min="0"
                max="3000"
                step="50"
                value={drawingsPounds}
                onChange={(e) => setDrawingsPounds(Number(e.target.value))}
                data-testid="what-if-drawings-slider"
                className="w-full accent-[#15803d]"
              />
              <span className="block text-[11px] text-[#4b8068]">
                {drawingsPounds > 0
                  ? `Pay yourself ${formatPounds(drawingsPounds * 100)}`
                  : "No extra drawings"}
              </span>
            </div>

            {/* Slider 2: Equipment purchase */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#14532d]">
                Buy work equipment/gear: £{equipmentPounds}
              </label>
              <input
                type="range"
                min="0"
                max="2000"
                step="50"
                value={equipmentPounds}
                onChange={(e) => setEquipmentPounds(Number(e.target.value))}
                data-testid="what-if-equipment-slider"
                className="w-full accent-[#15803d]"
              />
              <span className="block text-[11px] text-[#4b8068]">
                {equipmentPounds > 0
                  ? `Purchase ${formatPounds(equipmentPounds * 100)} of gear`
                  : "No new equipment"}
              </span>
            </div>

            {/* Toggle: Invoice Paid */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#14532d]">
                Client Payment
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[#14532d]">
                <input
                  type="checkbox"
                  checked={invoicePaid}
                  onChange={(e) => setInvoicePaid(e.target.checked)}
                  data-testid="what-if-invoice-toggle"
                  className="rounded text-[#15803d]"
                />
                Client pays {formatPounds(buckets.unpaidInvoicesPence)} invoices
              </label>
              <span className="block text-[11px] text-[#4b8068]">
                {invoicePaid
                  ? "Assumes 20% reserved for tax pot, 80% to safe spend"
                  : "Invoices stay unpaid"}
              </span>
            </div>
          </div>

          {/* Sandbox Live Impact Card */}
          <div
            className={`mt-6 rounded-xl border p-4 ${
              whatIf.isSafe
                ? "border-[#86efac] bg-[#f0fdf4] text-[#14532d]"
                : "border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]"
            }`}
            data-testid="what-if-impact-result"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold">
                  {whatIf.isSafe ? "✓ Safe Decision" : "⚠️ Buffer Warning"}
                </p>
                <p className="mt-0.5 text-xs opacity-90">{whatIf.message}</p>
              </div>
              <div className="text-right">
                <span className="text-xs uppercase opacity-75">
                  Resulting Safe Cash
                </span>
                <p className="text-xl font-extrabold">
                  {formatPounds(whatIf.newSafeToSpendPence)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
