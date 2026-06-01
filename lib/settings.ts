export type UserSettings = {
  legal_name: string;
  address: string;
  contact_details: string;
  default_payment_terms: string;
  bank_details: string;
  payment_link_provider: string;
  payment_link_url: string;
  vat_registered: boolean;
  vat_number: string;
  vat_rate: number;
  invoice_number_prefix: string;
  late_payment_wording: string;
  utr: string;
  companies_house_api_key: string;
};

export const DEFAULT_LATE_PAYMENT_WORDING =
  "Payment is due within 30 days of the invoice date. We reserve the right to charge statutory interest at 8% above the Bank of England base rate, plus statutory debt recovery costs, under the Late Payment of Commercial Debts (Interest) Act 1998.";

export const EMPTY_SETTINGS: UserSettings = {
  legal_name: "",
  address: "",
  contact_details: "",
  default_payment_terms: "Payment due within 30 days",
  bank_details: "",
  payment_link_provider: "",
  payment_link_url: "",
  vat_registered: false,
  vat_number: "",
  vat_rate: 20,
  invoice_number_prefix: "VC",
  late_payment_wording: DEFAULT_LATE_PAYMENT_WORDING,
  utr: "",
  companies_house_api_key: "",
};

export function sanitizeUserSettings(body: unknown): UserSettings | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const input = body as Record<string, unknown>;

  return {
    legal_name: String(input.legal_name ?? "").trim(),
    address: String(input.address ?? "").trim(),
    contact_details: String(input.contact_details ?? "").trim(),
    default_payment_terms:
      String(input.default_payment_terms ?? "").trim() || EMPTY_SETTINGS.default_payment_terms,
    bank_details: String(input.bank_details ?? "").trim(),
    payment_link_provider: sanitizePaymentProvider(input.payment_link_provider),
    payment_link_url: sanitizePaymentUrl(input.payment_link_url),
    vat_registered: Boolean(input.vat_registered),
    vat_number: String(input.vat_number ?? "").trim(),
    vat_rate: Number(input.vat_rate) || EMPTY_SETTINGS.vat_rate,
    invoice_number_prefix:
      String(input.invoice_number_prefix ?? "").trim().toUpperCase() ||
      EMPTY_SETTINGS.invoice_number_prefix,
    late_payment_wording:
      String(input.late_payment_wording ?? "").trim() || EMPTY_SETTINGS.late_payment_wording,
    utr: String(input.utr ?? "").trim(),
    companies_house_api_key: String(input.companies_house_api_key ?? "").trim(),
  };
}

function sanitizePaymentProvider(value: unknown) {
  const provider = String(value ?? "").trim().toLowerCase();
  return ["sumup", "stripe", "paypal", "other"].includes(provider) ? provider : "";
}

function sanitizePaymentUrl(value: unknown) {
  const url = String(value ?? "").trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}
