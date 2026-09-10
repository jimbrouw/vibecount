import { parseAmountToPence } from "@/lib/invoices/money";
import { parseInvoiceDateToIso } from "@/lib/invoices/validation";

export type RepeatingFrequency = "monthly" | "quarterly" | "yearly";

export function validateRepeatingTemplateInput(input: {
  clientId: string;
  title: string;
  description: string;
  amount: string;
  paymentTerms: string;
  frequency: string;
  nextRunDate: string;
}) {
  const clientId = input.clientId.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const amountPence = parseAmountToPence(input.amount);
  const frequency = normaliseFrequency(input.frequency);
  const nextRunDate = parseInvoiceDateToIso(input.nextRunDate);

  if (!clientId) return { ok: false as const, error: "Choose a client." };
  if (!title) return { ok: false as const, error: "Add a template title." };
  if (!description) return { ok: false as const, error: "Add what this invoice is for." };
  if (amountPence === null || amountPence <= 0) {
    return { ok: false as const, error: "Add an amount above £0." };
  }
  if (!frequency) return { ok: false as const, error: "Choose a repeat schedule." };
  if (!nextRunDate) return { ok: false as const, error: "Choose the first draft date." };

  return {
    ok: true as const,
    value: {
      clientId,
      title,
      description,
      amountPence,
      paymentTerms: input.paymentTerms.trim() || "Payment due within 30 days",
      frequency,
      nextRunDate,
    },
  };
}

export function nextRunDateFrom(dueDate: string, frequency: RepeatingFrequency) {
  const date = new Date(`${dueDate}T00:00:00Z`);
  if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  if (frequency === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function normaliseFrequency(value: string): RepeatingFrequency | null {
  if (value === "monthly" || value === "quarterly" || value === "yearly") {
    return value;
  }
  return null;
}
