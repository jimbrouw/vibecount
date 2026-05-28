import { formatPounds } from "@/lib/invoices/money";

export type SelfAssessmentRecord = {
  record_type: "income" | "expense";
  amount: string | number;
  record_categories: { name: string; sa103_box: string | null } | null;
};

export type SelfAssessmentChecklistItem = {
  id: string;
  form: "SA103S / SA103F";
  officialLabel: string;
  plainEnglish: string;
  whyItMatters: string;
  dataSource: string;
  fillMode: "suggested" | "needs_user" | "accountant_review";
  suggestedValue: string;
  evidence: string;
  reviewNote: string;
};

const EXPENSE_LINES = [
  {
    id: "cost-of-goods",
    officialLabel: "Cost of goods bought for resale or goods used",
    categoryMatchers: ["cost of goods"],
    plainEnglish: "Things you bought to sell on, or materials used to do the work.",
  },
  {
    id: "office-costs",
    officialLabel: "Office costs",
    categoryMatchers: ["office costs"],
    plainEnglish: "Running costs like stationery, postage, and small office items.",
  },
  {
    id: "travel-costs",
    officialLabel: "Travel costs",
    categoryMatchers: ["travel costs"],
    plainEnglish: "Business travel costs, not normal commuting.",
  },
  {
    id: "staff-costs",
    officialLabel: "Staff costs",
    categoryMatchers: ["staff costs"],
    plainEnglish: "Wages or payroll costs for people working in the business.",
  },
  {
    id: "subcontractors",
    officialLabel: "Subcontractor costs",
    categoryMatchers: ["subcontractor costs"],
    plainEnglish: "People or businesses you paid to help deliver client work.",
  },
  {
    id: "advertising",
    officialLabel: "Advertising and marketing",
    categoryMatchers: ["advertising and marketing"],
    plainEnglish: "Costs for finding customers, such as ads, design, or promotion.",
  },
  {
    id: "professional-fees",
    officialLabel: "Professional fees",
    categoryMatchers: ["professional fees"],
    plainEnglish: "Accountant, legal, or other professional help for the business.",
  },
  {
    id: "other-expenses",
    officialLabel: "Other allowable business expenses",
    categoryMatchers: ["other allowable expenses"],
    plainEnglish: "Business costs that do not fit the main categories.",
  },
] as const;

export function buildSelfAssessmentChecklist(records: SelfAssessmentRecord[]) {
  const incomeTotal = sumRecords(records, "income");
  const expenseTotal = sumRecords(records, "expense");
  const incomeCount = records.filter((record) => record.record_type === "income").length;
  const expenseCount = records.filter((record) => record.record_type === "expense").length;

  const items: SelfAssessmentChecklistItem[] = [
    {
      id: "turnover",
      form: "SA103S / SA103F",
      officialLabel: "Turnover",
      plainEnglish: "The total money your business made before taking off costs.",
      whyItMatters: "This is the top-line business income figure.",
      dataSource: "Approved income records",
      fillMode: incomeCount > 0 ? "suggested" : "needs_user",
      suggestedValue: incomeCount > 0 ? formatPounds(incomeTotal) : "Needs records",
      evidence: `${incomeCount} approved income records`,
      reviewNote:
        "Check cash payments, marketplace income, refunds, and whether you report on cash or invoice basis.",
    },
    {
      id: "total-expenses",
      form: "SA103S / SA103F",
      officialLabel: "Total allowable business expenses",
      plainEnglish: "Business costs you may be able to take off your income.",
      whyItMatters: "Expenses reduce the profit figure used for Self Assessment.",
      dataSource: "Approved expense records",
      fillMode: expenseCount > 0 ? "suggested" : "needs_user",
      suggestedValue: expenseCount > 0 ? formatPounds(expenseTotal) : "Needs records",
      evidence: `${expenseCount} approved expense records`,
      reviewNote:
        "Check private-use adjustments and any costs that may not be allowable.",
    },
    ...EXPENSE_LINES.map((line) => {
      const total = sumByCategory(records, line.categoryMatchers);
      const count = countByCategory(records, line.categoryMatchers);

      return {
        id: line.id,
        form: "SA103S / SA103F" as const,
        officialLabel: line.officialLabel,
        plainEnglish: line.plainEnglish,
        whyItMatters: "This helps group expenses into familiar Self Assessment areas.",
        dataSource: "Approved expense records by category",
        fillMode: count > 0 ? ("suggested" as const) : ("needs_user" as const),
        suggestedValue: count > 0 ? formatPounds(total) : "No matching records yet",
        evidence: `${count} matching approved records`,
        reviewNote:
          "Category mapping is a preparation aid. Check the final treatment before filing.",
      };
    }),
    {
      id: "profit",
      form: "SA103S / SA103F",
      officialLabel: "Net profit or loss",
      plainEnglish: "What is left after taking business costs away from business income.",
      whyItMatters: "This helps prepare the self-employment profit figure.",
      dataSource: "Approved income minus approved expenses",
      fillMode: incomeCount + expenseCount > 0 ? "suggested" : "needs_user",
      suggestedValue:
        incomeCount + expenseCount > 0
          ? formatPounds(incomeTotal - expenseTotal)
          : "Needs records",
      evidence: `${incomeCount + expenseCount} approved records`,
      reviewNote:
        "This is not a final tax calculation. Adjustments, allowances, and other income still matter.",
    },
    {
      id: "capital-allowances",
      form: "SA103S / SA103F",
      officialLabel: "Capital allowances",
      plainEnglish: "Tax relief for some longer-lasting business equipment.",
      whyItMatters: "Some equipment is handled differently from normal expenses.",
      dataSource: "User/accountant judgement",
      fillMode: "accountant_review",
      suggestedValue: "Needs review",
      evidence: "Not auto-filled by VibeCount yet",
      reviewNote:
        "Ask an accountant before treating larger equipment purchases as capital allowances.",
    },
    {
      id: "losses-adjustments",
      form: "SA103S / SA103F",
      officialLabel: "Losses, adjustments, and other information",
      plainEnglish: "Special cases that can change what goes on the return.",
      whyItMatters: "These can affect tax, but often need context outside VibeCount.",
      dataSource: "User/accountant input",
      fillMode: "accountant_review",
      suggestedValue: "Needs user input",
      evidence: "Not available from records alone",
      reviewNote:
        "Check losses brought forward, accounting basis, private use, and other income outside the business.",
    },
  ];

  return {
    incomeTotal,
    expenseTotal,
    profitTotal: incomeTotal - expenseTotal,
    incomeCount,
    expenseCount,
    items,
  };
}

function sumRecords(records: SelfAssessmentRecord[], type: "income" | "expense") {
  return records
    .filter((record) => record.record_type === type)
    .reduce((total, record) => total + Math.round(Number(record.amount) * 100), 0);
}

function sumByCategory(records: SelfAssessmentRecord[], matchers: readonly string[]) {
  return records
    .filter((record) => isMatchingExpense(record, matchers))
    .reduce((total, record) => total + Math.round(Number(record.amount) * 100), 0);
}

function countByCategory(records: SelfAssessmentRecord[], matchers: readonly string[]) {
  return records.filter((record) => isMatchingExpense(record, matchers)).length;
}

function isMatchingExpense(
  record: SelfAssessmentRecord,
  matchers: readonly string[]
) {
  const category = record.record_categories?.name.toLowerCase() ?? "";
  const sa103Box = record.record_categories?.sa103_box?.toLowerCase() ?? "";

  return (
    record.record_type === "expense" &&
    matchers.some((matcher) => category.includes(matcher) || sa103Box.includes(matcher))
  );
}
