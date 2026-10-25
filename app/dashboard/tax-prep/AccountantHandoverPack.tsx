"use client";

import { useState } from "react";
import { formatPounds, signedAmountToWords } from "@/lib/invoices/money";
import type { EmploymentRecord } from "@/lib/tax/employment";

interface AccountantHandoverPackProps {
  taxYearStart: number;
  taxYearLabel: string;
  incomeTotalPence: number;
  expenseTotalPence: number;
  profitTotalPence: number;
  incomeCount: number;
  expenseCount: number;
  emailTemplateText: string;
  employmentDetails?: EmploymentRecord | null;
}

export function AccountantHandoverPack({
  taxYearStart,
  taxYearLabel,
  incomeTotalPence,
  expenseTotalPence,
  profitTotalPence,
  incomeCount,
  expenseCount,
  emailTemplateText,
  employmentDetails,
}: AccountantHandoverPackProps) {
  const [copied, setCopied] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const formattedIncome = formatPounds(incomeTotalPence);
  const incomeWords = signedAmountToWords(incomeTotalPence);

  const formattedExpenses = formatPounds(expenseTotalPence);
  const expenseWords = signedAmountToWords(expenseTotalPence);

  const formattedProfit = formatPounds(profitTotalPence);
  const profitWords = signedAmountToWords(profitTotalPence);

  async function handleCopyEmail() {
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(emailTemplateText);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch {
      // Fallback if clipboard API is blocked
    }
  }

  return (
    <section
      data-testid="accountant-handover-card"
      className="mb-8 rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 p-6 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Accountant Ready
            </span>
            <span className="text-xs font-medium text-emerald-700">
              Tax Year {taxYearLabel}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-emerald-950">
            1-Click Accountant Handover Pack
          </h2>
          <p className="mt-1 text-sm text-emerald-800">
            Everything your accountant needs in one structured bundle. Figures in numbers and words with full bank reconciliation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/tax-prep/export?taxYearStart=${taxYearStart}&format=handover`}
            data-testid="accountant-handover-download-txt"
            download
            className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
          >
            Download Cover Note (.txt)
          </a>
          <a
            href={`/api/tax-prep/export?taxYearStart=${taxYearStart}&format=csv`}
            data-testid="accountant-handover-download-csv"
            download
            className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
          >
            Download Records (.csv)
          </a>
        </div>
      </div>

      {/* Safety Net / Numbers and Words Grid */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div
          data-testid="accountant-handover-turnover"
          className="rounded-xl border border-emerald-200/80 bg-white p-4 shadow-xs"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Turnover (Gross Income)
          </p>
          <p className="mt-1 text-2xl font-black tracking-tight text-emerald-950">
            {formattedIncome}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-600 italic">
            {incomeWords}
          </p>
          <p className="mt-2 text-xs text-emerald-600">
            {incomeCount} verified records
          </p>
        </div>

        <div
          data-testid="accountant-handover-expenses"
          className="rounded-xl border border-emerald-200/80 bg-white p-4 shadow-xs"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Allowable Expenses
          </p>
          <p className="mt-1 text-2xl font-black tracking-tight text-emerald-950">
            {formattedExpenses}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-600 italic">
            {expenseWords}
          </p>
          <p className="mt-2 text-xs text-emerald-600">
            {expenseCount} verified records
          </p>
        </div>

        <div
          data-testid="accountant-handover-profit"
          className="rounded-xl border-2 border-emerald-400 bg-emerald-50/60 p-4 shadow-xs"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
            Net Trading Profit
          </p>
          <p className="mt-1 text-2xl font-black tracking-tight text-emerald-950">
            {formattedProfit}
          </p>
          <p className="mt-1.5 text-xs font-medium text-emerald-900 italic">
            {profitWords}
          </p>
          <p className="mt-2 text-xs font-semibold text-emerald-700">
            Basis: UK Cash Basis
          </p>
        </div>
      </div>

      {/* Employment & Redundancy (SA102 / P45) Card */}
      {employmentDetails && (
        <div
          data-testid="accountant-handover-employment-card"
          className="mt-6 rounded-xl border border-sky-300 bg-sky-50/70 p-5 shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-sky-200 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                  SA102 Employment & P45
                </span>
                <span className="text-xs text-sky-800">
                  Ref: {employmentDetails.payeReference}
                </span>
              </div>
              <h3 className="mt-1 text-base font-bold text-sky-950">
                {employmentDetails.employerName}
              </h3>
              <p className="text-xs text-sky-800">
                Leaving Date: {employmentDetails.leavingDate} · Tax Code: {employmentDetails.taxCode}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
                PAYE Status
              </span>
              <p className="text-xs font-bold text-sky-900">Ceased in Tax Year {taxYearLabel}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-sky-200 bg-white p-3 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                Taxable Pay (P45 Box 7)
              </p>
              <p className="mt-1 text-lg font-black text-sky-950">
                {formatPounds(employmentDetails.taxablePayPence)}
              </p>
              <p className="mt-0.5 text-xs italic text-slate-600">
                {signedAmountToWords(employmentDetails.taxablePayPence)}
              </p>
            </div>

            <div className="rounded-lg border border-sky-200 bg-white p-3 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                PAYE Tax Deducted
              </p>
              <p className="mt-1 text-lg font-black text-sky-950">
                {formatPounds(employmentDetails.taxWithheldPence)}
              </p>
              <p className="mt-0.5 text-xs italic text-slate-600">
                {signedAmountToWords(employmentDetails.taxWithheldPence)}
              </p>
            </div>

            {employmentDetails.redundancyPaymentPence && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/80 p-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                    Redundancy Payment
                  </p>
                  <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900">
                    100% Tax-Free
                  </span>
                </div>
                <p className="mt-1 text-lg font-black text-emerald-950">
                  {formatPounds(employmentDetails.redundancyPaymentPence)}
                </p>
                <p className="mt-0.5 text-xs italic text-emerald-800">
                  Sec 401 ITEPA (under £30k threshold)
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg bg-sky-100/70 p-3 text-xs leading-relaxed text-sky-950">
            <p>
              <strong>Tax Return Impact:</strong> This employment fully utilized your Personal Allowance (£12,630) for {taxYearLabel}. Sole-trader freelance profits start being taxed at the 20% basic rate, with credit given for the £1,542.60 PAYE tax already deducted. The redundancy payment is completely tax-free and not added to taxable income.
            </p>
          </div>
        </div>
      )}

      {/* Email Template Collapsible */}
      <div className="mt-6 rounded-xl border border-emerald-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-emerald-950">
              Email to Accountant
            </span>
            <span className="text-xs text-slate-500">
              Copy-paste friendly draft
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEmail(!showEmail)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline"
            >
              {showEmail ? "Hide email text" : "Preview email text"}
            </button>
            <button
              type="button"
              onClick={handleCopyEmail}
              data-testid="accountant-handover-copy-email"
              className="inline-flex items-center rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200"
            >
              {copied ? "Copied to clipboard!" : "Copy Email"}
            </button>
          </div>
        </div>

        {showEmail && (
          <div className="mt-3">
            <textarea
              readOnly
              data-testid="accountant-handover-email-preview"
              rows={9}
              value={emailTemplateText}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Mandatory Compliance Disclaimer */}
      <div
        data-testid="accountant-handover-disclaimer"
        className="mt-4 rounded-lg bg-emerald-100/60 px-4 py-2.5 text-xs leading-relaxed text-emerald-900"
      >
        <p>
          <strong>MTD-ready records:</strong> Prepared from approved bank records and invoices for review by you and your accountant. This is a record-keeping handover aid and not an automated HMRC tax return filing or formal calculation of tax liability.
        </p>
      </div>
    </section>
  );
}
