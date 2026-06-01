import { parseAmountToPence } from "@/lib/invoices/money";
import { parseInvoiceDateToIso } from "@/lib/invoices/validation";

export type RecordType = "income" | "expense";
export type RecordStatus = "review" | "approved" | "excluded";

export type ValidRecordInput = {
  recordType: RecordType;
  recordDate: string;
  description: string;
  amountPence: number;
  categoryId: string;
  status: RecordStatus;
};

export function validateManualRecordInput(input: {
  recordType: string;
  recordDate: string;
  description: string;
  amount: string;
  categoryId: string;
  status: string;
}): { ok: true; value: ValidRecordInput } | { ok: false; error: string } {
  const recordType = input.recordType === "expense" ? "expense" : "income";
  const recordDate = parseInvoiceDateToIso(input.recordDate);
  const description = input.description.trim();
  const amountPence = parseAmountToPence(input.amount);
  const categoryId = input.categoryId.trim();
  const status = normaliseRecordStatus(input.status);

  if (!recordDate) {
    return { ok: false, error: "Use a valid record date." };
  }

  if (!description) {
    return { ok: false, error: "Add a short description." };
  }

  if (amountPence === null || amountPence <= 0) {
    return { ok: false, error: "Add an amount above £0." };
  }

  if (!categoryId) {
    return { ok: false, error: "Choose a category." };
  }

  return {
    ok: true,
    value: {
      recordType,
      recordDate,
      description,
      amountPence,
      categoryId,
      status,
    },
  };
}

export function normaliseRecordStatus(status: string): RecordStatus {
  if (status === "approved" || status === "excluded") {
    return status;
  }

  return "review";
}
