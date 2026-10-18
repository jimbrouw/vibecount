import {
  EMPTY_SETTINGS,
  sanitizeUserSettings,
  type UserSettings,
} from "./settings";

/** Explicit projection: never serialize a database settings row to the browser. */
export function publicSettings(input: unknown) {
  const settings = sanitizeUserSettings(input) ?? EMPTY_SETTINGS;
  return {
    ...settings,
    companies_house_api_key: "",
    companies_house_configured: Boolean(settings.companies_house_api_key),
  };
}

export type InvoiceDefaults = Pick<
  UserSettings,
  | "legal_name"
  | "address"
  | "contact_details"
  | "default_payment_terms"
  | "bank_details"
  | "payment_link_provider"
  | "payment_link_url"
  | "vat_registered"
  | "vat_number"
  | "vat_rate"
  | "invoice_number_prefix"
  | "late_payment_wording"
> & { hasSettings: boolean; companiesHouseConfigured: boolean };

export function invoiceDefaults(input: unknown): InvoiceDefaults {
  const s = sanitizeUserSettings(input) ?? EMPTY_SETTINGS;
  return {
    legal_name: s.legal_name,
    address: s.address,
    contact_details: s.contact_details,
    default_payment_terms: s.default_payment_terms,
    bank_details: s.bank_details,
    payment_link_provider: s.payment_link_provider,
    payment_link_url: s.payment_link_url,
    vat_registered: s.vat_registered,
    vat_number: s.vat_number,
    vat_rate: s.vat_rate,
    invoice_number_prefix: s.invoice_number_prefix,
    late_payment_wording: s.late_payment_wording,
    hasSettings: Boolean(s.legal_name || s.bank_details || s.contact_details),
    companiesHouseConfigured: Boolean(s.companies_house_api_key),
  };
}

/** A blank replacement preserves the saved credential. Removal must be explicit. */
export function settingsWrite(input: unknown) {
  const settings = sanitizeUserSettings(input);
  if (!settings) return null;
  const { companies_house_api_key: key, ...rest } = settings;
  const remove =
    (input as Record<string, unknown>).remove_companies_house_key === true;
  return {
    ...rest,
    ...(remove
      ? { companies_house_api_key: "" }
      : key
        ? { companies_house_api_key: key }
        : {}),
  };
}

/** Seller/payment details shown in invoice review; compare before publishing a revision. */
export function invoiceSellerReview(s: InvoiceDefaults) {
  return {
    legal_name: s.legal_name,
    address: s.address,
    contact_details: s.contact_details,
    bank_details: s.bank_details,
    payment_link_provider: s.payment_link_provider,
    payment_link_url: s.payment_link_url,
    late_payment_wording: s.late_payment_wording,
  };
}
