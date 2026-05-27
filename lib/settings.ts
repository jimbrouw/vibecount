export type UserSettings = {
  legal_name: string;
  address: string;
  contact_details: string;
  default_payment_terms: string;
  bank_details: string;
  vat_registered: boolean;
  vat_number: string;
  vat_rate: number;
  invoice_number_prefix: string;
  late_payment_wording: string;
  utr: string;
};

export const EMPTY_SETTINGS: UserSettings = {
  legal_name: "",
  address: "",
  contact_details: "",
  default_payment_terms: "Payment due within 30 days",
  bank_details: "",
  vat_registered: false,
  vat_number: "",
  vat_rate: 20,
  invoice_number_prefix: "VC",
  late_payment_wording:
    "Late payments may be subject to statutory interest and compensation.",
  utr: "",
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
    vat_registered: Boolean(input.vat_registered),
    vat_number: String(input.vat_number ?? "").trim(),
    vat_rate: Number(input.vat_rate) || EMPTY_SETTINGS.vat_rate,
    invoice_number_prefix:
      String(input.invoice_number_prefix ?? "").trim().toUpperCase() ||
      EMPTY_SETTINGS.invoice_number_prefix,
    late_payment_wording:
      String(input.late_payment_wording ?? "").trim() || EMPTY_SETTINGS.late_payment_wording,
    utr: String(input.utr ?? "").trim(),
  };
}
