export type ClusterableTransaction = {
  id: string;
  decision_version: number;
  transaction_date: string;
  signed_amount_pence: number | string | null;
  currency?: string;
  description: string;
  reference: string;
  classification: string;
  dedupe_status: string;
  category_id?: string | null;
  business_use_bps?: number;
};

export type MerchantCluster = {
  key: string;
  name: string;
  kind: "expense" | "income";
  count: number;
  totalPence: number;
  earliestDate: string;
  latestDate: string;
  suggestedClassification: "Business" | "Personal";
  suggestedCategoryName: string | null;
  transactions: ClusterableTransaction[];
};

/**
 * Cleans noisy bank statement descriptions into friendly merchant names.
 * Removes card numbers, terminal codes, dates, and common transaction noise.
 */
export function cleanMerchantName(description: string): string {
  if (!description) return "Unknown Merchant";

  let clean = description.trim();

  // Common pattern replacements
  const knownPatterns: [RegExp, string][] = [
    [/^TFL\.GOV\.UK\/CP.*$/i, "TfL Travel"],
    [/^TFL TRAVEL.*$/i, "TfL Travel"],
    [/^TFL.*$/i, "TfL Travel"],
    [/^AMZNMKTPLACE.*$/i, "Amazon Marketplace"],
    [/^AMAZON\.CO\.UK.*$/i, "Amazon"],
    [/^AMAZON UK.*$/i, "Amazon"],
    [/^ADOBE\s*\*.*$/i, "Adobe"],
    [/^GITHUB\s*\*.*$/i, "GitHub"],
    [/^GOOGLE\s*\*.*WORKSPACE.*$/i, "Google Workspace"],
    [/^GOOGLE\s*\*.*CLOUD.*$/i, "Google Cloud"],
    [/^GOOGLE\s*\*.*SERVICES.*$/i, "Google"],
    [/^APPLE\.COM\/BILL.*$/i, "Apple"],
    [/^TRAINLINE.*$/i, "Trainline"],
    [/^UBER\s*\*TRIP.*$/i, "Uber Travel"],
    [/^UBER\s*\*EATS.*$/i, "Uber Eats"],
    [/^PRET\s*A\s*MANGER.*$/i, "Pret A Manger"],
    [/^STARBUCKS.*$/i, "Starbucks"],
    [/^TESCO\s*STORES?.*$/i, "Tesco"],
    [/^TESCO\s*EXPRESS.*$/i, "Tesco Express"],
    [/^SAINSBURYS?\s*S\/MKTS?.*$/i, "Sainsbury's"],
    [/^SAINSBURYS?\s*LOCAL.*$/i, "Sainsbury's Local"],
    [/^MARKS\s*&\s*SPENCER.*$/i, "M&S"],
    [/^M&S\s*SIMPLY.*$/i, "M&S"],
    [/^WAITROSE.*$/i, "Waitrose"],
    [/^CO-OP\s*GROUP.*$/i, "Co-op"],
    [/^BOOTS\s*THE\s*CHEMIST.*$/i, "Boots"],
    [/^POST\s*OFFICE.*$/i, "Post Office"],
    [/^DELIVEROO.*$/i, "Deliveroo"],
    [/^SPOTIFY.*$/i, "Spotify"],
    [/^NETFLIX.*$/i, "Netflix"],
  ];

  for (const [regex, replacement] of knownPatterns) {
    if (regex.test(clean)) return replacement;
  }

  // Strip generic payment prefixes
  clean = clean.replace(/^(POS|DEB|CARD|DD|SO|BGC|FPI|FPO|DIRECT DEBIT)\s+/i, "");

  // Strip terminal IDs, card suffixes: "CD 1234", "xxxx-1234", "12/05/25"
  clean = clean.replace(/\b(CD|CARD)\s*\d{3,4}\b/gi, "");
  clean = clean.replace(/\b\d{4}\s*\d{2}\/\d{2}\b/g, "");
  clean = clean.replace(/\b\d{2}[A-Z]{3}\d{2,4}\b/gi, "");
  clean = clean.replace(/\b[A-Z0-9]{8,}\b/g, ""); // long random reference codes
  clean = clean.replace(/[#*\\/]+/g, " ");
  clean = clean.replace(/\s+/g, " ").trim();

  if (!clean) return "Unknown Merchant";

  // Capitalize words nicely
  return clean
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Suggests default classification and SA103/Record category based on merchant name.
 */
export function getMerchantSuggestion(
  merchantName: string,
  kind: "expense" | "income",
): { classification: "Business" | "Personal"; categoryName: string | null } {
  if (kind === "income") {
    return { classification: "Business", categoryName: "Sales / Turnover" };
  }

  const lower = merchantName.toLowerCase();

  // Known Business Services
  if (
    lower.includes("adobe") ||
    lower.includes("github") ||
    lower.includes("google workspace") ||
    lower.includes("google cloud") ||
    lower.includes("apple") ||
    lower.includes("aws") ||
    lower.includes("figma") ||
    lower.includes("zoom") ||
    lower.includes("slack")
  ) {
    return { classification: "Business", categoryName: "Software & Subscriptions" };
  }

  if (
    lower.includes("tfl") ||
    lower.includes("trainline") ||
    lower.includes("uber travel") ||
    lower.includes("national rail") ||
    lower.includes("post office")
  ) {
    return { classification: "Business", categoryName: "Travel & Transport" };
  }

  // Personal / Private spending
  if (
    lower.includes("tesco") ||
    lower.includes("sainsbury") ||
    lower.includes("waitrose") ||
    lower.includes("m&s") ||
    lower.includes("co-op") ||
    lower.includes("starbucks") ||
    lower.includes("pret a manger") ||
    lower.includes("uber eats") ||
    lower.includes("deliveroo") ||
    lower.includes("netflix") ||
    lower.includes("spotify")
  ) {
    return { classification: "Personal", categoryName: null };
  }

  return { classification: "Business", categoryName: null };
}

/**
 * Clusters unreviewed transactions by cleaned merchant name.
 * Orders clusters by:
 * 1. Multi-item clusters first (highest count desc)
 * 2. Total amount desc
 */
export function clusterSourceTransactions(
  transactions: ClusterableTransaction[],
  options?: { onlyUnreviewed?: boolean },
): MerchantCluster[] {
  const onlyUnreviewed = options?.onlyUnreviewed ?? true;

  const filtered = onlyUnreviewed
    ? transactions.filter(
        (t) =>
          t.classification === "Unknown" &&
          t.dedupe_status === "clear" &&
          t.signed_amount_pence !== null,
      )
    : transactions.filter(
        (t) => t.dedupe_status === "clear" && t.signed_amount_pence !== null,
      );

  const clusterMap = new Map<string, ClusterableTransaction[]>();

  for (const tx of filtered) {
    const rawPence = Number(tx.signed_amount_pence);
    const kind = rawPence > 0 ? "income" : "expense";
    const cleaned = cleanMerchantName(tx.description);
    const clusterKey = `${cleaned.toLowerCase()}|${kind}`;

    if (!clusterMap.has(clusterKey)) {
      clusterMap.set(clusterKey, []);
    }
    clusterMap.get(clusterKey)!.push(tx);
  }

  const clusters: MerchantCluster[] = [];

  for (const [key, txs] of clusterMap.entries()) {
    const [_, kindStr] = key.split("|");
    const kind = kindStr as "expense" | "income";
    const name = cleanMerchantName(txs[0].description);

    const sortedDates = txs.map((t) => t.transaction_date).sort();
    const totalPence = txs.reduce(
      (sum, t) => sum + Math.abs(Number(t.signed_amount_pence)),
      0,
    );

    const suggestion = getMerchantSuggestion(name, kind);

    clusters.push({
      key,
      name,
      kind,
      count: txs.length,
      totalPence,
      earliestDate: sortedDates[0],
      latestDate: sortedDates.at(-1)!,
      suggestedClassification: suggestion.classification,
      suggestedCategoryName: suggestion.categoryName,
      transactions: txs.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)),
    });
  }

  // Multi-transaction clusters first, then by count desc, then total money desc
  return clusters.sort((a, b) => {
    if (a.count > 1 && b.count === 1) return -1;
    if (a.count === 1 && b.count > 1) return 1;
    if (b.count !== a.count) return b.count - a.count;
    return b.totalPence - a.totalPence;
  });
}
