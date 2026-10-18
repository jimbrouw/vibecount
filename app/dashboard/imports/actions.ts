"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeSourceCsv,
  readSourceCsv,
  MAX_SOURCE_BYTES,
  type CsvMapping,
} from "@/lib/records/source-csv";
import { storeSourceCsv } from "@/lib/records/source-store";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";

function fail(message: string): never {
  redirect(`/dashboard/imports?error=${encodeURIComponent(message)}`);
}
async function ownerClient() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (!user || error) redirect("/login");
  return { db, user };
}

export async function createFinancialAccount(form: FormData) {
  const { db, user } = await ownerClient();
  const label = redactBankDetailsForPrompt(
    String(form.get("label") ?? "").trim(),
  );
  const provider = String(form.get("provider") ?? "");
  const mask = String(form.get("mask") ?? "").trim();
  if (
    !label ||
    label.length > 80 ||
    !/^[a-zA-Z0-9]{1,4}$/.test(mask) ||
    !["starling", "nationwide", "amex", "generic"].includes(provider)
  )
    fail("Add a label, provider and the last four characters only.");
  const { error } = await db.from("financial_accounts").insert({
    user_id: user.id,
    label,
    provider,
    masked_identifier: mask,
    account_type: provider === "amex" ? "credit_card" : "bank",
    currency: "GBP",
  });
  if (error)
    fail(
      "Could not save the account label. Check the source-ledger migration.",
    );
  revalidatePath("/dashboard/imports");
  redirect("/dashboard/imports");
}

export async function importSourceCsv(form: FormData) {
  const { db, user } = await ownerClient();
  const accountId = String(form.get("accountId") ?? "");
  const { data: account, error: accountError } = await db
    .from("financial_accounts")
    .select("id,currency")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountError || !account)
    fail("Choose one of your saved account labels.");
  if(account.currency!=='GBP') fail('This import requires a GBP account. Foreign sources need the complete reviewed valuation workflow.');
  const file = form.get("sourceFile");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_SOURCE_BYTES)
    fail("Choose a CSV between 1 byte and 1 MB.");
  if (form.get("mappingConfirmed") !== "yes")
    fail("Preview and confirm the mapping before importing.");
  let result: { import_id: string; created: boolean; transactions: number };
  try {
    const mapping: CsvMapping = JSON.parse(String(form.get("mapping") ?? ""));
    if (!mapping || typeof mapping !== "object")
      throw new Error("Choose a valid field mapping.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = readSourceCsv(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const accountColumn = table[0].findIndex((header) => header.trim().toLowerCase() === "account");
    if (accountColumn >= 0 && new Set(table.slice(1).filter((row) => row.some((cell) => cell.trim()))
      .map((row) => row[accountColumn].trim()).filter(Boolean)).size > 1) {
      throw new Error("This file combines accounts. Upload the original CSV from each bank or card separately; nothing has been imported.");
    }
    const rows = normalizeSourceCsv(table, mapping);
    if (!rows.length) throw new Error("CSV has no transaction rows.");
    result = await storeSourceCsv({
      owner: user.id,
      account: account.id,
      bytes,
      filename: file.name,
      mapping,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not import CSV.");
  }
  revalidatePath("/dashboard/imports");
  redirect(
    `/dashboard/imports?import=${result.import_id}&result=${result.created ? "staged" : "existing"}`,
  );
}

export async function classifySourceTransaction(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Review the amount and confirm this decision.");
  const classification = String(form.get("classification") ?? "Unknown");
  const percent = String(form.get("percent") ?? "").trim();
  if (classification === "Mixed" && !/^\d{1,2}(\.\d{1,2})?$/.test(percent))
    fail("Enter a mixed business percentage between 0 and 100.");
  const [whole, fraction = ""] = percent.split(".");
  const bps =
    classification === "Business"
      ? 10000
      : classification === "Mixed"
        ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
        : 0;
  const included = ["Business", "Mixed"].includes(classification);
  const { error } = await db.rpc("review_bank_transaction", {
    p_id: String(form.get("transactionId") ?? ""),
    p_version: Number(form.get("version")),
    p_classification: classification,
    p_category: included ? String(form.get("categoryId") ?? "") || null : null,
    p_bps: bps,
    p_rationale: redactBankDetailsForPrompt(
      String(form.get("rationale") ?? "").trim(),
    ),
  });
  if (error)
    fail(
      "Could not save the decision. Reload, check the category/percentage and resolve any possible duplicate first.",
    );
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/records");
  revalidatePath("/dashboard/tax-prep");
  const importId = String(form.get("importId") ?? "");
  redirect(
    `/dashboard/imports?import=${encodeURIComponent(importId)}&result=reviewed`,
  );
}

export async function reverseSourceImport(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Review all import totals before reversing.");
  const id = String(form.get("importId") ?? "");
  const { error } = await db.rpc("reverse_source_import", {
    p_id: id,
    p_stamp: String(form.get("stamp") ?? ""),
    p_reason: redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    ),
  });
  if (error)
    fail(
      "Could not reverse this import. Reload and review its current totals.",
    );
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/records");
  revalidatePath("/dashboard/tax-prep");
  redirect(
    `/dashboard/imports?import=${encodeURIComponent(id)}&result=reversed`,
  );
}

export async function reopenSourceImport(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Confirm reopening the import for review.");
  const id = String(form.get("importId") ?? "");
  const { error } = await db.rpc("reopen_source_import", { p_id: id });
  if (error) fail("Could not reopen this import.");
  revalidatePath("/dashboard/imports");
  redirect(`/dashboard/imports?import=${encodeURIComponent(id)}`);
}
