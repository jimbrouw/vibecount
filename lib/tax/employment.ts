export interface EmploymentRecord {
  employerName: string;
  payeReference: string;
  leavingDate: string;
  taxCode: string;
  nationalInsuranceNumber?: string;
  taxablePayPence: number;
  taxWithheldPence: number;
  employeeNicPence?: number;
  employeePensionPence?: number;
  redundancyPaymentPence?: number;
  redundancyExemptPence?: number;
  notes?: string[];
}

// User-specific or verified historical employment facts
const VERIFIED_EMPLOYMENT_RECORDS: Record<string, Record<number, EmploymentRecord>> = {
  // James Frank Brouwer
  'ed18c91e-926e-415b-ad1b-989b198edc92': {
    2025: {
      employerName: 'Nottingham Contemporary',
      payeReference: '507 / LA10989',
      leavingDate: '2025-09-29',
      taxCode: '1263L',
      nationalInsuranceNumber: 'JK 64 29 03 D',
      taxablePayPence: 1403352, // £14,033.52
      taxWithheldPence: 154260, // £1,542.60
      employeeNicPence: 61962,  // £619.62
      employeePensionPence: 44910, // £449.10
      redundancyPaymentPence: 1025525, // £10,255.25
      redundancyExemptPence: 1025525,  // £10,255.25 (100% exempt under £30k Sec 401 ITEPA)
      notes: [
        "Verified from P45 Part 1/1A and October 2025 Payslip.",
        "Employment salary used full Personal Allowance (£12,630) for 2025/26.",
        "Redundancy payment of £10,255.25 is statutory/ex-gratia and 100% tax-free under Section 401 ITEPA 2003.",
        "PAYE tax deducted (£1,542.60) should be applied as tax credit on overall Self Assessment."
      ]
    }
  }
};

/**
 * Returns verified employment records for a user and tax year if available.
 */
export async function getEmploymentRecord(userId: string, taxYearStart: number): Promise<EmploymentRecord | null> {
  const userRecords = VERIFIED_EMPLOYMENT_RECORDS[userId];
  if (userRecords && userRecords[taxYearStart]) {
    return userRecords[taxYearStart];
  }
  return null;
}
