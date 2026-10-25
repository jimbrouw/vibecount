import { formatPounds, amountToWords } from "../invoices/money.ts";

export type CashBucketResult = {
  totalCashPence: number;
  safeToSpendPence: number;
  taxProtectionPence: number;
  unpaidInvoicesPence: number;
  monthlyBurnPence: number | null;
  runwayMonths: number | null;
  runwayStatus: "comfortable" | "stable" | "tight" | "unknown";
  taxNudgePence: number;
  summaryHeadline: string;
  summaryDescription: string;
};

export type WhatIfParams = {
  baseSafePence: number;
  baseTaxPence: number;
  baseMonthlyBurnPence: number | null;
  drawingsAdjustmentPence: number; // e.g. taking £1,000 out
  equipmentPurchasePence: number; // e.g. buying £500 gear
  incomingInvoicePaidPence: number; // e.g. client pays £850 invoice
  taxReserveRatioBps?: number; // default 20% (2000 bps)
};

export type WhatIfResult = {
  newSafeToSpendPence: number;
  newTaxProtectionPence: number;
  newRunwayMonths: number | null;
  isSafe: boolean;
  message: string;
};

/**
 * Calculates 3-bucket cash summary and runway from financial plan numbers.
 */
export function calculateCashBuckets(params: {
  actualCashPence: number | null;
  liabilitiesPence: number | null;
  actualTaxReservePence: number | null;
  requiredTaxProtectionPence: number | null;
  currentFreeCashPence: number | null;
  monthlyCostsPence: number | null;
  monthlyDrawingsPence: number | null;
  unpaidInvoicesPence?: number | null;
}): CashBucketResult {
  const actualCash = Math.max(0, params.actualCashPence ?? 0);
  const liabilities = Math.max(0, params.liabilitiesPence ?? 0);
  const requiredTax = Math.max(0, params.requiredTaxProtectionPence ?? 0);
  const actualTax = Math.max(0, params.actualTaxReservePence ?? 0);
  const unpaidInvoices = Math.max(0, params.unpaidInvoicesPence ?? 0);

  // Total protected = tax needed + debt
  const totalProtected = requiredTax + liabilities;

  // Safe to spend = either evaluated free cash or cash minus protected
  const safeToSpend =
    params.currentFreeCashPence !== null
      ? Math.max(0, params.currentFreeCashPence)
      : Math.max(0, actualCash - totalProtected);

  // Additional tax to move to reserve pot
  const taxNudge = Math.max(0, requiredTax - actualTax);

  // Monthly burn (business costs + personal drawings)
  const monthlyCosts = Math.max(0, params.monthlyCostsPence ?? 0);
  const monthlyDrawings = Math.max(0, params.monthlyDrawingsPence ?? 0);
  const monthlyBurn =
    params.monthlyCostsPence !== null || params.monthlyDrawingsPence !== null
      ? monthlyCosts + monthlyDrawings
      : null;

  // Calculate runway in months
  let runwayMonths: number | null = null;
  let runwayStatus: CashBucketResult["runwayStatus"] = "unknown";

  if (monthlyBurn && monthlyBurn > 0) {
    const rawMonths = safeToSpend / monthlyBurn;
    runwayMonths = Math.round(rawMonths * 10) / 10; // 1 decimal place

    if (runwayMonths >= 3) {
      runwayStatus = "comfortable";
    } else if (runwayMonths >= 1) {
      runwayStatus = "stable";
    } else {
      runwayStatus = "tight";
    }
  }

  // Plain-English description
  let summaryHeadline = "";
  let summaryDescription = "";

  if (runwayMonths !== null) {
    if (runwayStatus === "comfortable") {
      summaryHeadline = `You have ${runwayMonths} months of comfortable runway.`;
      summaryDescription = `Your £${(safeToSpend / 100).toFixed(2)} in safe cash covers your usual living and business spending through the next ${runwayMonths} months without touching tax money.`;
    } else if (runwayStatus === "stable") {
      summaryHeadline = `You have ${runwayMonths} months of cash runway.`;
      summaryDescription = `Your safe cash covers about ${runwayMonths} months. Once pending invoices arrive, your buffer will extend.`;
    } else {
      summaryHeadline = "Your cash buffer is running tight.";
      summaryDescription =
        "Your safe cash covers less than one month of estimated spending. Prioritise collecting unpaid invoices before making new purchases.";
    }
  } else {
    summaryHeadline = `${formatPounds(safeToSpend)} safe for you to spend.`;
    summaryDescription = `You have ${formatPounds(safeToSpend)} (${amountToWords(safeToSpend)}) available after reserving ${formatPounds(totalProtected)} for taxes and debts.`;
  }

  return {
    totalCashPence: actualCash,
    safeToSpendPence: safeToSpend,
    taxProtectionPence: totalProtected,
    unpaidInvoicesPence: unpaidInvoices,
    monthlyBurnPence: monthlyBurn,
    runwayMonths,
    runwayStatus,
    taxNudgePence: taxNudge,
    summaryHeadline,
    summaryDescription,
  };
}

/**
 * Evaluates a real-time "What-If" decision in the sandbox without altering the database.
 */
export function evaluateWhatIf(params: WhatIfParams): WhatIfResult {
  const taxRatioBps = params.taxReserveRatioBps ?? 2000; // 20%
  const invoiceTaxReserve = Math.round((params.incomingInvoicePaidPence * taxRatioBps) / 10000);
  const invoiceNetSafe = params.incomingInvoicePaidPence - invoiceTaxReserve;

  // New safe spend = base + incoming net - drawings out - equipment out
  const newSafeToSpend =
    params.baseSafePence +
    invoiceNetSafe -
    params.drawingsAdjustmentPence -
    params.equipmentPurchasePence;

  // New tax protection = base + invoice tax
  const newTaxProtection = params.baseTaxPence + invoiceTaxReserve;

  let newRunwayMonths: number | null = null;
  if (params.baseMonthlyBurnPence && params.baseMonthlyBurnPence > 0) {
    newRunwayMonths =
      Math.max(0, Math.round((newSafeToSpend / params.baseMonthlyBurnPence) * 10)) / 10;
  }

  const isSafe = newSafeToSpend >= 0;

  let message = "";
  if (!isSafe) {
    const deficit = Math.abs(newSafeToSpend);
    message = `This decision would dip £${(deficit / 100).toFixed(2)} into your protected tax or debt money. Consider waiting until unpaid invoices arrive.`;
  } else if (newRunwayMonths !== null) {
    message = `You will still have ${formatPounds(newSafeToSpend)} (${amountToWords(newSafeToSpend)}) in safe cash, covering ${newRunwayMonths} months of runway.`;
  } else {
    message = `You will have ${formatPounds(newSafeToSpend)} (${amountToWords(newSafeToSpend)}) in safe cash remaining.`;
  }

  return {
    newSafeToSpendPence: newSafeToSpend,
    newTaxProtectionPence: newTaxProtection,
    newRunwayMonths,
    isSafe,
    message,
  };
}
