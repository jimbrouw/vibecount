export type GlossaryTerm = {
  id: string;
  term: string;
  explanation: string;
  example: string;
};

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    id: "self-assessment",
    term: "Self Assessment",
    explanation:
      "The annual process where you tell HM Revenue & Customs (HMRC) how much money you made as a self-employed freelancer, and pay the tax and National Insurance you owe on those earnings.",
    example:
      "You are a freelance graphic designer. By January 31st each year, you must submit a Self Assessment tax return online to show what you earned between April 6th of the previous year and April 5th of this year.",
  },
  {
    id: "allowable-expenses",
    term: "Allowable Expenses",
    explanation:
      "Essential business costs that you pay specifically to run your freelance business. You subtract these from your total earnings (turnover) so you only pay tax on your actual profits.",
    example:
      "You bought a camera for GBP1,000 for your freelance photography work, and spent GBP200 on travel. These are allowable expenses, so if you made GBP10,000 in turnover, you only pay tax on GBP8,800 of profit.",
  },
  {
    id: "payment-on-account",
    term: "Payment on Account",
    explanation:
      "Advance payments towards your next self-employed tax bill. HMRC charges these twice a year to spread the tax cost out, based on a guess that you will earn the same as the previous year.",
    example:
      "Your tax bill for last year was GBP3,000. HMRC will automatically ask you to pay GBP1,500 by January 31st and another GBP1,500 by July 31st as advance payments for the upcoming year.",
  },
  {
    id: "unique-taxpayer-reference",
    term: "Unique Taxpayer Reference",
    explanation:
      "A personal 10-digit number given to you by HMRC when you register as self-employed. It acts as your unique tax fingerprint and is required to log in or pay taxes.",
    example:
      "When you register for Self Assessment, HMRC sends a welcome letter containing your 10-digit UTR. You must quote this whenever you contact HMRC or make a tax payment.",
  },
  {
    id: "national-insurance",
    term: "National Insurance",
    explanation:
      "A separate self-employed tax paid alongside your regular Income Tax. It builds your eligibility for state benefits, such as the State Pension and maternity allowances.",
    example:
      "As a freelancer, if your annual profits exceed the self-employed threshold, you will pay Class 4 National Insurance contributions (calculated as a percentage of your profit) through your Self Assessment return.",
  },
  {
    id: "value-added-tax-vat",
    term: "Value Added Tax (VAT)",
    explanation:
      "A tax added to the price of most goods and services. If your business turnover goes above GBP90,000 in a 12-month period, you must register for VAT, charge it to clients, and pay it to HMRC.",
    example:
      "You are registered for VAT and invoice a client GBP1,000 for consulting. You must add 20% VAT (GBP200), bringing the total to GBP1,200. You collect that GBP200 and pay it to HMRC later.",
  },
  {
    id: "turnover",
    term: "Turnover",
    explanation:
      "The total amount of money your business receives from clients before any expenses, taxes, or material costs are deducted.",
    example:
      "If you send 10 invoices of GBP1,000 each during the tax year and they are all paid, your turnover for that year is exactly GBP10,000, even if you spent GBP2,000 on tools.",
  },
  {
    id: "profit",
    term: "Profit",
    explanation:
      "The actual money your freelance business has made after you subtract all of your allowable business expenses from your total turnover.",
    example:
      "If your total turnover is GBP15,000 and your allowable business expenses (software, travel, office supplies) total GBP3,000, your taxable profit is GBP12,000.",
  },
  {
    id: "accounts-payable",
    term: "Accounts Payable",
    explanation:
      "The money that your freelance business owes to others, such as suppliers, subcontractors, or utility providers, for services or goods already received.",
    example:
      "You hired a freelance illustrator to draw a custom icon for a client project and they invoiced you GBP300 with 14-day terms. Until you pay them, that GBP300 is part of your accounts payable.",
  },
  {
    id: "accounts-receivable",
    term: "Accounts Receivable",
    explanation:
      "The money that your clients owe you for services you have finished and invoiced, but have not yet received payment for.",
    example:
      "You sent a GBP1,500 invoice to a client for web design work with 30-day payment terms. Until the client transfers that GBP1,500 into your bank account, it is an accounts receivable.",
  },
  {
    id: "flat-rate-vat-scheme",
    term: "Flat Rate VAT Scheme",
    explanation:
      "An alternative way for small businesses to pay VAT. Instead of keeping track of VAT on every single purchase, you pay HMRC a fixed, lower percentage of your total VAT-inclusive turnover.",
    example:
      "Under the standard scheme, you pay VAT on sales minus VAT on purchases. Under the Flat Rate scheme, you might pay a flat 10% of your total sales to HMRC, simplifying your bookkeeping.",
  },
  {
    id: "sole-trader",
    term: "Sole Trader",
    explanation:
      "The simplest business structure where you run your business as an individual. You are personally responsible for any business debts, and your business profits are taxed as personal income.",
    example:
      "You work as a freelance copywriter under your own name or a trading name. You are a sole trader, meaning there is no legal distinction between you and your business.",
  },
  {
    id: "hmrc",
    term: "HMRC",
    explanation:
      "His Majesty's Revenue and Customs (HMRC) is the UK government department responsible for collecting taxes, administering tax laws, and paying state support.",
    example:
      "When you file your self-employed tax return, you submit it to HMRC, and you send your tax payments directly to HMRC's bank accounts.",
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
