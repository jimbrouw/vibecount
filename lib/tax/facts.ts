import { decimalToPence } from "../money";
export const factKinds = [
  "employment",
  "termination",
  "pension",
  "other_income",
  "tax_payment",
  "vehicle",
  "gift_aid",
  "trade_adjustment",
] as const;
export type FactKind = (typeof factKinds)[number];
export type Field = {
  key: string;
  label: string;
  type:
    "money" | "signed_money" | "date" | "percent" | "miles" | "text" | "select";
  options?: string[];
  optional?: boolean;
};
export const factFields: Record<FactKind, Field[]> = {
  employment: [
    {
      key: "taxable_pay_pence",
      label: "Taxable pay from this employment (not take-home pay)",
      type: "money",
    },
    {
      key: "income_tax_withheld_pence",
      label: "PAYE Income Tax withheld (negative if refunded; exclude NI)",
      type: "signed_money",
    },
    {
      key: "class1_band_earnings_pence",
      label:
        "Class 1 NICable earnings between the primary threshold and upper earnings limit (blank if unknown)",
      type: "money",
      optional: true,
    },
    {
      key: "statement_basis",
      label:
        "Statement basis (one employment per fact; do not add cumulative P45 and P60 totals twice)",
      type: "select",
      options: [
        "p45_current_employment",
        "p60_year_total",
        "reviewed_corrected_total",
      ],
    },
    { key: "period_start", label: "Period start", type: "date" },
    { key: "period_end", label: "Period end", type: "date" },
  ],
  termination: [
    { key: "gross_pence", label: "Total termination payment", type: "money" },
    {
      key: "taxable_pence",
      label:
        "Reviewed taxable component (do not assume all redundancy is exempt)",
      type: "money",
    },
    {
      key: "income_tax_withheld_pence",
      label:
        "Tax withheld specifically on this component; do not repeat PAYE already recorded",
      type: "signed_money",
    },
    { key: "payment_date", label: "Payment date", type: "date" },
    {
      key: "treatment",
      label: "Breakdown review",
      type: "select",
      options: ["unresolved", "evidence_reviewed"],
    },
  ],
  pension: [
    { key: "net_paid_pence", label: "Personal amount paid", type: "money" },
    {
      key: "gross_contribution_pence",
      label: "Gross contribution including provider relief, if applicable",
      type: "money",
    },
    {
      key: "method",
      label: "Contribution/relief method",
      type: "select",
      options: [
        "unknown",
        "relief_at_source",
        "net_pay",
        "salary_sacrifice",
        "employer",
      ],
    },
    { key: "period_start", label: "Contribution period start", type: "date" },
    { key: "period_end", label: "Contribution period end", type: "date" },
  ],
  other_income: [
    {
      key: "income_type",
      label: "Income type",
      type: "select",
      options: [
        "other_non_savings",
        "savings_interest",
        "dividends",
        "property",
        "foreign",
        "pension_income",
        "unknown",
      ],
    },
    { key: "gross_pence", label: "Gross other income", type: "money" },
    {
      key: "income_tax_withheld_pence",
      label: "Income Tax already withheld",
      type: "signed_money",
    },
    { key: "payment_date", label: "Receipt date", type: "date" },
  ],
  tax_payment: [
    {
      key: "payment_reference",
      label:
        "Safe payment identity, such as HMRC statement item 3 (never your UTR or account number)",
      type: "text",
    },
    {
      key: "paid_total_pence",
      label: "Total physical payment shown on evidence",
      type: "money",
    },
    {
      key: "allocated_pence",
      label: "Amount allocated to this tax year and liability",
      type: "money",
    },
    {
      key: "allocation_type",
      label: "Liability allocation",
      type: "select",
      options: [
        "first_payment_on_account",
        "second_payment_on_account",
        "balancing_payment",
        "other_reviewed_credit",
      ],
    },
    {
      key: "payment_date",
      label: "Actual payment date (may be outside this tax year)",
      type: "date",
    },
  ],
  vehicle: [
    {
      key: "vehicle_type",
      label: "Vehicle type",
      type: "select",
      options: ["car", "van", "motorcycle", "bicycle", "ebike"],
    },
    {
      key: "method",
      label: "Expense method election",
      type: "select",
      options: ["unknown", "actual_costs", "simplified_mileage"],
    },
    {
      key: "business_use_bps",
      label: "Reviewed business-use percentage",
      type: "percent",
    },
    {
      key: "business_miles_hundredths",
      label: "Evidenced business miles (blank if unknown)",
      type: "miles",
      optional: true,
    },
    { key: "period_start", label: "Election period start", type: "date" },
    { key: "period_end", label: "Election period end", type: "date" },
  ],
  gift_aid: [
    {
      key: "net_donation_pence",
      label: "Personal Gift Aid donation paid (never a trading expense)",
      type: "money",
    },
    { key: "payment_date", label: "Donation date", type: "date" },
  ],
  trade_adjustment: [
    {
      key: "adjustment_type",
      label: "Adjustment type requiring tax review",
      type: "select",
      options: [
        "add_back",
        "capital_allowance",
        "loss_brought_forward",
        "other_deduction",
        "trading_allowance",
      ],
    },
    { key: "amount_pence", label: "Adjustment magnitude", type: "money" },
    {
      key: "treatment",
      label: "Eligibility review",
      type: "select",
      options: ["unresolved", "evidence_reviewed"],
    },
  ],
};
export const profileFields = {
  jurisdiction: ["unknown", "england_wales_ni", "scotland"],
  accounting_basis: ["unknown", "cash", "traditional"],
  business_structure: ["unknown", "sole_trader", "partnership", "company"],
  vat_registered: ["unknown", "yes", "no"],
  student_loan: [
    "unknown",
    "none",
    "plan1",
    "plan2",
    "plan4",
    "plan5",
    "postgraduate",
    "multiple",
  ],
  residency: ["unknown", "uk_full_year", "other"],
  special_reliefs: ["unknown", "none", "present"],
  ledger_completeness: ["unreviewed", "complete"],
} as const;
export type ProfileData = Record<keyof typeof profileFields, string>;
export const emptyProfile = () =>
  Object.fromEntries(
    Object.keys(profileFields).map((k) => [
      k,
      k === "ledger_completeness" ? "unreviewed" : "unknown",
    ]),
  ) as ProfileData;
export function validateProfile(data: unknown, reviewed = false): ProfileData {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Review a tax profile.");
  const d = data as ProfileData;
  if (
    Object.keys(d).length !== Object.keys(profileFields).length ||
    Object.entries(profileFields).some(
      ([k, options]) =>
        !(options as readonly string[]).includes(d[k as keyof ProfileData]),
    )
  )
    throw new Error("Review every explicit profile answer.");
  if (
    reviewed &&
    Object.values(d).some((v) => v === "unknown" || v === "unreviewed")
  )
    throw new Error("Unknown profile answers remain provisional.");
  return d;
}
export function validateFact(
  kind: FactKind,
  input: unknown,
  year: number,
  state = "provisional",
): Record<string, string | number | null> {
  if (
    !factKinds.includes(kind) ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  )
    throw new Error("Review a supported fact and tax year.");
  const d = input as Record<string, string | number | null>,
    fields = factFields[kind];
  if (Object.keys(d).some((k) => !fields.some((f) => f.key === k)))
    throw new Error("Unexpected fact fields.");
  for (const f of fields) {
    const v = d[f.key];
    if (v === null || v === undefined) {
      if (f.optional) continue;
      throw new Error("Missing " + f.label);
    }
    if (["money", "signed_money", "percent", "miles"].includes(f.type)) {
      if (
        !Number.isSafeInteger(v) ||
        Math.abs(Number(v)) > 999999999999 ||
        (f.type !== "signed_money" && Number(v) < 0) ||
        (f.type === "percent" && Number(v) > 10000)
      )
        throw new Error("Invalid exact value for " + f.label);
    } else if (
      typeof v !== "string" ||
      (f.type === "select" && !f.options?.includes(v)) ||
      (f.type === "text" && (!v.trim() || v.length > 120)) ||
      (f.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          Number.isNaN(Date.parse(v + "T00:00:00Z")) ||
          new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v))
    )
      throw new Error("Invalid " + f.label);
    if (
      f.type === "date" &&
      kind !== "tax_payment" &&
      (String(v) < `${year}-04-06` || String(v) > `${year + 1}-04-05`)
    )
      throw new Error("Fact dates must belong to the selected tax year.");
  }
  if (d.period_start && d.period_end && d.period_end < d.period_start)
    throw new Error("Period ends before it starts.");
  if (kind === "termination" && Number(d.taxable_pence) > Number(d.gross_pence))
    throw new Error("Taxable component exceeds total payment.");
  if (
    kind === "pension" &&
    Number(d.gross_contribution_pence) < Number(d.net_paid_pence)
  )
    throw new Error(
      "Gross contribution cannot be below the personal amount paid.",
    );
  if (
    kind === "tax_payment" &&
    (Number(d.allocated_pence) > Number(d.paid_total_pence) ||
      Number(d.allocated_pence) <= 0)
  )
    throw new Error("Review the actual payment and allocation.");
  if (
    kind === "vehicle" &&
    d.method === "simplified_mileage" &&
    ["bicycle", "ebike"].includes(String(d.vehicle_type))
  )
    throw new Error(
      "Employee bicycle mileage is not a sole-trader simplified expense method.",
    );
  if (
    state === "verified" &&
    ((kind === "pension" && d.method === "unknown") ||
      (kind === "vehicle" &&
        (d.method === "unknown" ||
          Number(d.business_use_bps) <= 0 ||
          (d.method === "simplified_mileage" &&
            d.business_miles_hundredths == null))) ||
      (["termination", "trade_adjustment"].includes(kind) &&
        d.treatment !== "evidence_reviewed") ||
      (kind === "other_income" && d.income_type === "unknown"))
  )
    throw new Error("Resolve the treatment before verifying this fact.");
  return d;
}
export function parseFactInputs(
  kind: FactKind,
  values: Record<string, string>,
  year: number,
  state: string,
) {
  const data: Record<string, string | number | null> = {};
  for (const f of factFields[kind]) {
    const text = values[f.key]?.trim() ?? "";
    if (!text && f.optional) {
      data[f.key] = null;
      continue;
    }
    if (["money", "signed_money", "percent", "miles"].includes(f.type)) {
      const n = decimalToPence(text);
      if (n === null) throw new Error("Enter an exact amount for " + f.label);
      data[f.key] = n;
    } else data[f.key] = text;
  }
  return validateFact(kind, data, year, state);
}
export type TaxProfileRevision = {
  id: string;
  profile_id: string;
  financial_stamp: string;
  ledger_is_current: boolean;
  ordinal: number;
  state: "provisional" | "reviewed";
  data: ProfileData;
  rationale: string;
  created_at: string;
};
export type TaxFact = {
  id: string;
  family_id: string;
  ordinal: number;
  kind: FactKind;
  label: string;
  tax_year_start: number;
  state: "provisional" | "verified" | "excluded" | "withdrawn";
  data: Record<string, string | number | null>;
  rationale: string;
  created_at: string;
};
