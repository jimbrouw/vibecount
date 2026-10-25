"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import MerchantClusterReview from "@/app/dashboard/imports/MerchantClusterReview";
import type { ClusterableTransaction } from "@/lib/records/merchant-clusters";
import CashBucketsView from "@/app/dashboard/finance/CashBucketsView";

type CategoryOption = {
  id: string;
  name: string;
  record_type: "income" | "expense";
};

type RecentImport = {
  id: string;
  original_filename: string;
  created_at: string;
  coverage_start: string | null;
  coverage_end: string | null;
};

type UnpaidInvoice = {
  id: string;
  number: string;
  amount: number | string;
  due_date: string | null;
  client_name: string;
};

type Props = {
  unreviewedTransactions: ClusterableTransaction[];
  categories: CategoryOption[];
  recentImports: RecentImport[];
  unpaidInvoices: UnpaidInvoice[];
  cashBucketProps: {
    actualCashPence: number | null;
    liabilitiesPence: number | null;
    actualTaxReservePence: number | null;
    requiredTaxProtectionPence: number | null;
    currentFreeCashPence: number | null;
    monthlyCostsPence: number | null;
    monthlyDrawingsPence: number | null;
    unpaidInvoicesPence: number;
  };
};

export default function CheckInWizard({
  unreviewedTransactions,
  categories,
  recentImports,
  unpaidInvoices,
  cashBucketProps,
}: Props) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  const steps = [
    { num: 1, title: "1. Fresh Statements", subtitle: "Check uploaded files" },
    { num: 2, title: "2. Sort Payments", subtitle: "Grouped merchant review" },
    { num: 3, title: "3. Incoming Invoices", subtitle: "Check client payments" },
    { num: 4, title: "4. Your Safe Cash", subtitle: "Takeaway & peace of mind" },
  ];

  return (
    <div className="space-y-8" data-testid="checkin-wizard">
      {/* Wizard Progress Stepper */}
      <nav
        aria-label="Check-in Steps"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {steps.map((s) => {
          const isActive = currentStep === s.num;
          const isDone = currentStep > s.num;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setCurrentStep(s.num as 1 | 2 | 3 | 4)}
              className={`flex flex-col rounded-xl border p-3 text-left transition ${
                isActive
                  ? "border-[#15803d] bg-[#dcfce7] text-[#14532d]"
                  : isDone
                    ? "border-[#86efac] bg-white text-[#166534]"
                    : "border-gray-200 bg-white/60 text-gray-400"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    isActive
                      ? "bg-[#15803d] text-white"
                      : isDone
                        ? "bg-[#86efac] text-[#14532d]"
                        : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone ? "✓" : s.num}
                </span>
                <span className="text-xs font-bold">{s.title}</span>
              </div>
              <span className="mt-1 text-[11px] opacity-80">{s.subtitle}</span>
            </button>
          );
        })}
      </nav>

      {/* Step 1: Statements Status */}
      {currentStep === 1 && (
        <section
          className="space-y-6 rounded-2xl border border-[#bbf7d0] bg-white p-6 shadow-xs"
          data-testid="checkin-step-1"
        >
          <div>
            <h2 className="text-xl font-bold text-[#14532d]">
              Step 1: Check your statement files
            </h2>
            <p className="mt-1 text-sm text-[#4b8068]">
              Make sure your recent bank and card transactions are uploaded before sorting.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#166534]">
              Recent Preserved Statements
            </h3>
            {recentImports.length === 0 ? (
              <p className="text-sm text-gray-500">No statements uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-[#f0fdf4] rounded-xl border border-[#dcfce7] bg-[#f0fdf4] p-3 text-sm">
                {recentImports.slice(0, 3).map((imp) => (
                  <li
                    key={imp.id}
                    className="flex items-center justify-between py-2 text-xs text-[#14532d]"
                  >
                    <span className="font-semibold">{imp.original_filename}</span>
                    <span className="text-[#4b8068]">
                      {imp.coverage_start && imp.coverage_end
                        ? `${imp.coverage_start} to ${imp.coverage_end}`
                        : new Date(imp.created_at).toLocaleDateString("en-GB")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/dashboard/imports"
              className="text-xs font-semibold text-[#15803d] underline hover:text-[#14532d]"
            >
              + Upload a new bank/card CSV statement
            </Link>

            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              data-testid="checkin-next-btn-1"
              className="cursor-pointer rounded-xl bg-[#15803d] px-6 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#166534]"
            >
              Continue to Step 2: Sort Payments →
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Clustered Merchant Sort */}
      {currentStep === 2 && (
        <section
          className="space-y-6 rounded-2xl border border-[#bbf7d0] bg-white p-6 shadow-xs"
          data-testid="checkin-step-2"
        >
          <div className="flex flex-col justify-between gap-2 border-b border-[#f0fdf4] pb-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold text-[#14532d]">
                Step 2: Quick Merchant Grouping
              </h2>
              <p className="mt-1 text-sm text-[#4b8068]">
                Review recurring subscriptions, travel, and personal expenses together in 1 click.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              data-testid="checkin-next-btn-2"
              className="cursor-pointer self-start rounded-xl bg-[#15803d] px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#166534] sm:self-center"
            >
              Continue to Step 3 →
            </button>
          </div>

          <MerchantClusterReview
            transactions={unreviewedTransactions}
            categories={categories}
          />
        </section>
      )}

      {/* Step 3: Incoming Invoices */}
      {currentStep === 3 && (
        <section
          className="space-y-6 rounded-2xl border border-[#bbf7d0] bg-white p-6 shadow-xs"
          data-testid="checkin-step-3"
        >
          <div>
            <h2 className="text-xl font-bold text-[#14532d]">
              Step 3: Check Client Payments
            </h2>
            <p className="mt-1 text-sm text-[#4b8068]">
              Match incoming deposits to your open invoices so your records and clients stay settled.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#166534]">
              Open / Unpaid Invoices ({unpaidInvoices.length})
            </h3>
            {unpaidInvoices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#86efac] p-6 text-center">
                <p className="text-sm font-semibold text-[#14532d]">
                  All client invoices are paid or reconciled! 👏
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#f0fdf4] rounded-xl border border-[#dcfce7] bg-white p-2">
                {unpaidInvoices.map((inv) => {
                  const pence = Math.round(Number(inv.amount) * 100);
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-col justify-between gap-1 py-3 px-3 text-xs sm:flex-row sm:items-center"
                    >
                      <div>
                        <span className="font-bold text-[#14532d]">
                          Invoice #{inv.number}
                        </span>
                        <span className="ml-2 text-[#4b8068]">
                          to {inv.client_name}
                        </span>
                        {inv.due_date && (
                          <span className="ml-2 text-amber-800">
                            (Due {inv.due_date})
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[#14532d]">
                          {formatPounds(pence)}
                        </span>
                        <span className="ml-2 text-[11px] text-[#4b8068] italic">
                          ({amountToWords(pence)})
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/dashboard/reconciliation"
              className="text-xs font-semibold text-[#15803d] underline hover:text-[#14532d]"
            >
              Open full bank-to-invoice reconciliation matcher →
            </Link>

            <button
              type="button"
              onClick={() => setCurrentStep(4)}
              data-testid="checkin-next-btn-3"
              className="cursor-pointer rounded-xl bg-[#15803d] px-6 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#166534]"
            >
              Finish: See Safe Cash & Takeaway →
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Summary & Safe Cash Takeaway */}
      {currentStep === 4 && (
        <section
          className="space-y-6 rounded-2xl border-2 border-[#15803d] bg-white p-6 shadow-sm"
          data-testid="checkin-step-4"
        >
          <div className="rounded-xl border border-[#86efac] bg-[#f0fdf4] p-4 text-center">
            <span className="text-3xl">🎉</span>
            <h2 className="mt-2 text-xl font-bold text-[#14532d]">
              Check-In Complete! You're on top of your numbers.
            </h2>
            <p className="mt-1 text-sm text-[#166534]">
              Here is your verified cash breakdown for this week.
            </p>
          </div>

          <CashBucketsView {...cashBucketProps} />

          <div className="flex flex-col items-center justify-between gap-4 border-t border-[#f0fdf4] pt-6 sm:flex-row">
            <Link
              href="/dashboard"
              data-testid="checkin-finish-btn"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#15803d] px-8 text-sm font-bold text-white shadow-xs transition hover:bg-[#14532d]"
            >
              Return to Dashboard
            </Link>
            <Link
              href="/dashboard/finance"
              className="text-xs font-semibold text-[#15803d] underline hover:text-[#14532d]"
            >
              Open detailed annual plan & forecast →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
