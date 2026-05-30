export type GlossaryTerm = {
  id: string;
  term: string;
  explanation: string;
  example: string;
};

// Founder-approved content. Terms marked VERIFY need accountant sign-off before launch.
const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    id: "sole-trader",
    term: "Sole trader",
    explanation:
      "You and the business are the same legal person. No company, you keep the profit, you owe the tax.",
    example:
      "Invoicing clients under your own name or a trading name, not a Ltd company.",
  },
  {
    id: "self-assessment",
    term: "Self Assessment",
    explanation:
      "The system you use to tell HMRC what you earned and work out your tax.",
    example: "Once a year you log in and declare your self-employed income.",
  },
  {
    id: "utr",
    term: "UTR (Unique Taxpayer Reference)",
    explanation: "A personal 10-digit tax ID number.",
    example: "A 10-digit number that goes on every tax return.",
  },
  {
    id: "government-gateway",
    term: "Government Gateway",
    explanation: "The HMRC login used to file and pay.",
    example: "One user ID and password for all HMRC services.",
  },
  {
    id: "tax-year",
    term: "Tax year",
    explanation: "The 12 months HMRC measures: 6 April to 5 April.",
    example: "The 2026/27 tax year runs 6 Apr 2026 to 5 Apr 2027.",
  },
  {
    id: "turnover",
    term: "Turnover (gross income)",
    explanation: "Total money the business brought in, before any costs.",
    example: "GBP 48,000 of invoiced work is the turnover.",
  },
  {
    id: "allowable-expenses",
    term: "Allowable expenses",
    explanation:
      "Costs that can be subtracted because they are wholly and exclusively for the business.",
    example:
      "Software subscriptions, a portion of phone, travel to a client site.",
  },
  {
    id: "taxable-profit",
    term: "Taxable profit",
    explanation:
      "Turnover minus allowable expenses. The figure tax is charged on.",
    example:
      "GBP 48,000 turnover minus GBP 9,000 costs = GBP 39,000 taxable profit.",
  },
  {
    id: "personal-allowance",
    term: "Personal Allowance",
    explanation: "Income earned tax-free each year (GBP 12,570).",
    example: "The first GBP 12,570 of profit carries GBP 0 income tax.",
  },
  {
    id: "tax-rates",
    term: "Basic / Higher / Additional rate",
    explanation: "The income tax bands: 20% / 40% / 45%.",
    example: "Profit above GBP 50,270 is taxed at 40%.",
  },
  // VERIFY: confirm GBP 1,000 Trading Allowance is still current
  {
    id: "trading-allowance",
    term: "Trading Allowance",
    explanation:
      "A flat GBP 1,000 of self-employment income you can earn tax-free, instead of claiming expenses.",
    example: "A side income of GBP 800 needs no declaration.",
  },
  {
    id: "class-4-nics",
    term: "Class 4 NICs",
    explanation:
      "National Insurance on profits: 6% then 2%. Paid via Self Assessment.",
    example:
      "On GBP 39,000 profit, 6% applies to the slice above GBP 12,570.",
  },
  // VERIFY: confirm Class 2 NIC voluntary rate and current rules
  {
    id: "class-2-nics",
    term: "Class 2 NICs",
    explanation:
      "Old flat-rate NI, now mostly automatic/voluntary; still counts toward State Pension.",
    example:
      "Not paid above the threshold, but pension credit still builds.",
  },
  {
    id: "payment-on-account",
    term: "Payment on Account",
    explanation:
      "Advance payments toward next year's bill, in two instalments.",
    example: "Half of next year's estimated tax paid each January and July.",
  },
  {
    id: "balancing-payment",
    term: "Balancing Payment",
    explanation:
      "The top-up if the actual bill was higher than the advance payments.",
    example:
      "Owing more than was pre-paid means settling the difference by 31 Jan.",
  },
  {
    id: "capital-allowances",
    term: "Capital allowances",
    explanation:
      "Tax relief for buying bigger kit or equipment (capital items).",
    example: "A GBP 2,000 equipment purchase claimed as a capital allowance.",
  },
  // VERIFY: confirm current Annual Investment Allowance cap
  {
    id: "annual-investment-allowance",
    term: "Annual Investment Allowance (AIA)",
    explanation:
      "Lets you deduct the full cost of most equipment in the year you buy it.",
    example: "A GBP 3,000 workstation deducted in full that year.",
  },
  {
    id: "simplified-expenses",
    term: "Simplified expenses",
    explanation: "Flat-rate shortcuts instead of working out exact costs.",
    example: "A fixed pence-per-mile rate instead of real car costs.",
  },
  // VERIFY: confirm current use-of-home flat rates
  {
    id: "use-of-home",
    term: "Use of home (flat rate)",
    explanation: "A set monthly amount claimable for working from home.",
    example: "A fixed monthly figure based on hours worked at home.",
  },
  {
    id: "cash-basis",
    term: "Cash basis",
    explanation:
      "Record income/expenses when money actually moves. Now the default for sole traders.",
    example: "A payment received in May counts in May.",
  },
  {
    id: "accruals-basis",
    term: "Accruals (traditional) basis",
    explanation:
      "Record income/expenses when earned/incurred, not when paid.",
    example:
      "An invoice raised in March counts in March, even if paid later.",
  },
  {
    id: "value-added-tax-vat",
    term: "VAT (Value Added Tax)",
    explanation:
      "A 20% (standard) tax on most goods/services that registered businesses add and reclaim.",
    example: "Charging GBP 1,000 + GBP 200 VAT on an invoice.",
  },
  {
    id: "vat-threshold",
    term: "VAT registration threshold",
    explanation:
      "The turnover level (GBP 90,000) where registering becomes compulsory.",
    example:
      "Hitting GBP 90k taxable turnover in any rolling 12 months triggers registration.",
  },
  {
    id: "output-vat",
    term: "Output VAT",
    explanation: "VAT charged to customers and owed to HMRC.",
    example: "The GBP 200 added to an invoice.",
  },
  {
    id: "input-vat",
    term: "Input VAT",
    explanation: "VAT paid on purchases that can be reclaimed.",
    example: "VAT paid on a work laptop.",
  },
  // VERIFY: confirm applicable flat rate % for freelancer/creative sector
  {
    id: "vat-flat-rate",
    term: "VAT Flat Rate Scheme",
    explanation:
      "Pay a fixed % of turnover as VAT instead of tracking every transaction.",
    example: "A simpler VAT method for small businesses with few expenses.",
  },
  {
    id: "mtd",
    term: "Making Tax Digital (MTD) for Income Tax",
    explanation:
      "Mandatory digital records + quarterly updates to HMRC, replacing one annual return.",
    example:
      "Over GBP 50k turnover means filing quarterly via software from Apr 2026.",
  },
  // Retained from original glossary — not in founder's list
  {
    id: "hmrc",
    term: "HMRC",
    explanation:
      "His Majesty's Revenue and Customs — the UK government department responsible for collecting taxes, administering tax laws, and paying state support.",
    example:
      "When you file your self-employed tax return, you submit it to HMRC, and send your tax payments directly to HMRC's bank accounts.",
  },
  {
    id: "accounts-payable",
    term: "Accounts Payable",
    explanation:
      "The money your freelance business owes to others — suppliers, subcontractors, or utility providers — for services or goods already received.",
    example:
      "You hired a freelance illustrator and they invoiced you GBP 300 with 14-day terms. Until you pay, that GBP 300 is accounts payable.",
  },
  {
    id: "accounts-receivable",
    term: "Accounts Receivable",
    explanation:
      "The money clients owe you for services you have finished and invoiced, but not yet received payment for.",
    example:
      "You sent a GBP 1,500 invoice with 30-day terms. Until the client pays, that GBP 1,500 is accounts receivable.",
  },
];

function normalizeTerm(term: string) {
  return term.trim().toLowerCase();
}

function isPlaceholder(term: GlossaryTerm) {
  return (
    term.explanation.toLowerCase().includes("placeholder") ||
    term.example.toLowerCase().includes("placeholder")
  );
}

export function resolveGlossaryTerms(databaseTerms: GlossaryTerm[]) {
  const databaseByTerm = new Map(
    databaseTerms.map((term) => [normalizeTerm(term.term), term] as const)
  );

  const resolved = GLOSSARY_TERMS.map((seedTerm) => {
    const databaseTerm = databaseByTerm.get(normalizeTerm(seedTerm.term));

    if (!databaseTerm || isPlaceholder(databaseTerm)) {
      return { ...seedTerm, id: databaseTerm?.id ?? seedTerm.id };
    }

    return databaseTerm;
  });

  const seedTerms = new Set(GLOSSARY_TERMS.map((term) => normalizeTerm(term.term)));
  const extraDatabaseTerms = databaseTerms.filter(
    (term) => !seedTerms.has(normalizeTerm(term.term))
  );

  return [...resolved, ...extraDatabaseTerms];
}
