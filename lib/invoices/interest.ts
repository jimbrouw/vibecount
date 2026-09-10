export type LateInterestCalculation = {
  daysOverdue: number;
  interestAmountPence: number;
  fixedFeePence: number;
  totalLateFeePence: number;
};

/**
 * Calculates the late payment interest and fixed fee for an overdue invoice.
 * Statutory interest is calculated daily: (Debt * InterestRate / 100) / 365 * DaysOverdue
 * Fixed fees:
 * - Up to £999.99: £40
 * - £1000 to £9999.99: £70
 * - £10000+: £100
 *
 * @param amountPence The principal amount of the invoice in pence.
 * @param dueDate The date the invoice was due (YYYY-MM-DD).
 * @param interestRate The annual interest rate (e.g., 13.25 for 13.25%).
 * @param currentDate The current date to calculate up to (defaults to today).
 * @returns Calculation breakdown or null if not overdue or invalid.
 */
export function calculateLateInterest(
  amountPence: number,
  dueDate: string,
  interestRate: number,
  currentDate: Date = new Date()
): LateInterestCalculation | null {
  if (amountPence <= 0 || !dueDate) {
    return null;
  }

  const due = new Date(`${dueDate}T00:00:00Z`);
  if (isNaN(due.getTime())) {
    return null;
  }

  // Calculate difference in days
  const timeDiff = currentDate.getTime() - due.getTime();
  const daysOverdue = Math.floor(timeDiff / (1000 * 3600 * 24));

  if (daysOverdue <= 0) {
    return null;
  }

  // Daily interest formula
  const dailyInterest = (amountPence * (interestRate / 100)) / 365;
  const interestAmountPence = Math.round(dailyInterest * daysOverdue);

  // Fixed statutory fee based on debt amount
  let fixedFeePence = 0;
  if (amountPence < 1000_00) {
    fixedFeePence = 40_00; // £40
  } else if (amountPence < 10000_00) {
    fixedFeePence = 70_00; // £70
  } else {
    fixedFeePence = 100_00; // £100
  }

  return {
    daysOverdue,
    interestAmountPence,
    fixedFeePence,
    totalLateFeePence: interestAmountPence + fixedFeePence,
  };
}
