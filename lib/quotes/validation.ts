import { normaliseClientName, parseAmountToPence } from "@/lib/invoices/money";
import { parseInvoiceDateToIso } from "@/lib/invoices/validation";

export function validateServiceInput(input: {
  name: string;
  description: string;
  unitPrice: string;
}) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  const unitPricePence = parseAmountToPence(input.unitPrice);

  if (!name) return { ok: false as const, error: "Add a service name." };
  if (!description) return { ok: false as const, error: "Add a service description." };
  if (unitPricePence === null || unitPricePence <= 0) {
    return { ok: false as const, error: "Add a service price above £0." };
  }

  return { ok: true as const, value: { name, description, unitPricePence } };
}

export function validateQuoteInput(input: {
  clientName: string;
  quoteDate: string;
  validUntil: string;
  description: string;
  quantity: string;
  unitPrice: string;
  notes: string;
  serviceId: string;
}) {
  const clientName = normaliseClientName(input.clientName);
  const quoteDate = parseInvoiceDateToIso(input.quoteDate);
  const validUntil = input.validUntil.trim()
    ? parseInvoiceDateToIso(input.validUntil)
    : null;
  const description = input.description.trim();
  const quantity = Number(input.quantity || "1");
  const unitPricePence = parseAmountToPence(input.unitPrice);

  if (!clientName) return { ok: false as const, error: "Add a client name." };
  if (!quoteDate) return { ok: false as const, error: "Use a valid quote date." };
  if (input.validUntil.trim() && !validUntil) {
    return { ok: false as const, error: "Use a valid expiry date." };
  }
  if (!description) return { ok: false as const, error: "Add what the quote is for." };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false as const, error: "Quantity must be above 0." };
  }
  if (unitPricePence === null || unitPricePence <= 0) {
    return { ok: false as const, error: "Add a price above £0." };
  }

  return {
    ok: true as const,
    value: {
      clientName,
      quoteDate,
      validUntil,
      description,
      quantity,
      unitPricePence,
      notes: input.notes.trim(),
      serviceId: input.serviceId.trim() || null,
    },
  };
}
